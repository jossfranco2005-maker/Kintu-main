import { createServerFn } from "@tanstack/react-start";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Database } from "@/integrations/supabase/types";
import {
  loadUserBudgetCategories,
  resolveCategoryFromBudgetSet,
  resolveUserCategory,
} from "@/lib/finance/user-category.server";
import { isValidIsoDate } from "@/lib/finance/date";
import {
  type MovementChange,
  type MovementSnapshot,
  type MovementStatus,
} from "@/lib/finance/movement-effects";
import { syncBudgetEffects, type BudgetEffectAlert } from "@/lib/finance/movement-effects.server";
import { areMovementsDuplicates, type DuplicateMovement } from "@/lib/movements/duplicates";
import {
  createImportNotification,
  createTransactionNotification,
} from "@/lib/notifications/transaction.server";

const transactionInputSchema = z.object({
  type: z.enum(["income", "expense"]),
  amount: z.number().positive("El monto debe ser mayor a cero"),
  date: z.string().refine(isValidIsoDate, "La fecha debe tener formato AAAA-MM-DD y ser válida"),
  category: z.string().trim().min(1, "La categoría es requerida"),
  description: z.string().trim().max(500).nullable().optional(),
  merchant: z.string().trim().max(200).nullable().optional(),
  created_at: z.string().datetime({ offset: true }).nullable().optional(),
  status: z.enum(["confirmed", "pending"]).nullable().optional(),
});

type PersistedTransaction = {
  id: string;
  type: "income" | "expense";
  amount: number | string;
  date: string;
  category: string;
  status: string;
  description?: string | null;
  merchant?: string | null;
  created_at?: string | null;
};

function normalizeStatus(status: string | null | undefined): MovementStatus {
  return status === "pending" ? "pending" : "confirmed";
}

function toSnapshot(transaction: PersistedTransaction): MovementSnapshot {
  return {
    type: transaction.type,
    amount: Number(transaction.amount),
    date: transaction.date,
    category: transaction.category.trim().toLowerCase(),
    status: normalizeStatus(transaction.status),
  };
}

async function applyMovementEffectsSafely(
  supabase: SupabaseClient,
  userId: string,
  changes: MovementChange[],
): Promise<BudgetEffectAlert[]> {
  try {
    return await syncBudgetEffects({ supabase, userId, changes });
  } catch (error) {
    // La transacción financiera ya quedó persistida. Una falla secundaria en
    // alertas no debe hacer creer a la interfaz que el movimiento no se guardó.
    console.error("[movements] No se pudieron sincronizar los efectos presupuestarios:", error);
    return [];
  }
}

export const listTransactions = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data: transactions, error } = await supabase
      .from("transactions")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: false });

    if (error) throw new Error(error.message);
    return { transactions: transactions || [] };
  });

export const createTransaction = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data: unknown) => transactionInputSchema.parse(data))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const category = await resolveUserCategory({
      supabase,
      userId,
      input: data.category,
    });
    const { data: inserted, error } = await supabase
      .from("transactions")
      .insert({
        user_id: userId,
        type: data.type,
        amount: data.amount,
        date: data.date,
        category,
        description: data.description || null,
        merchant: data.merchant || null,
        source: "manual",
        status: data.status || "confirmed",
        created_at: data.created_at || new Date().toISOString(),
      })
      .select("id, type, amount, date, category, merchant, status")
      .single();

    if (error || !inserted) {
      throw new Error(error?.message || "No se pudo crear el movimiento.");
    }

    const alerts = await applyMovementEffectsSafely(supabase, userId, [
      { before: null, after: toSnapshot(inserted as PersistedTransaction) },
    ]);

    if (normalizeStatus(inserted.status) === "confirmed") {
      try {
        await createTransactionNotification({
          supabase,
          userId,
          transaction: {
            transactionId: inserted.id,
            type: inserted.type,
            amount: Number(inserted.amount),
            category: inserted.category,
            merchant: inserted.merchant,
            date: inserted.date,
            channel: "manual",
          },
        });
      } catch (notificationError) {
        console.error("[movements] No se pudo crear la notificación:", notificationError);
      }
    }

    return { ok: true, transactionId: inserted.id, alerts };
  });

export const updateTransaction = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data: unknown) =>
    z
      .object({
        id: z.string().uuid(),
      })
      .merge(transactionInputSchema)
      .parse(data),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: existing, error: existingError } = await supabase
      .from("transactions")
      .select("id, type, amount, date, category, status")
      .eq("id", data.id)
      .eq("user_id", userId)
      .maybeSingle();

    if (existingError) throw new Error(existingError.message);
    if (!existing) throw new Error("El movimiento no existe o no pertenece al usuario.");

    const category = await resolveUserCategory({
      supabase,
      userId,
      input: data.category,
    });
    const updatePayload: Database["public"]["Tables"]["transactions"]["Update"] = {
      type: data.type,
      amount: data.amount,
      date: data.date,
      category,
      description: data.description || null,
      merchant: data.merchant || null,
      status: data.status || normalizeStatus(existing.status),
    };

    if (data.created_at) updatePayload.created_at = data.created_at;

    const { data: updated, error } = await supabase
      .from("transactions")
      .update(updatePayload)
      .eq("id", data.id)
      .eq("user_id", userId)
      .select("id, type, amount, date, category, merchant, status")
      .single();

    if (error || !updated) {
      throw new Error(error?.message || "No se pudo actualizar el movimiento.");
    }

    const alerts = await applyMovementEffectsSafely(supabase, userId, [
      {
        before: toSnapshot(existing as PersistedTransaction),
        after: toSnapshot(updated as PersistedTransaction),
      },
    ]);

    const becameConfirmed =
      normalizeStatus(existing.status) === "pending" &&
      normalizeStatus(updated.status) === "confirmed";
    if (becameConfirmed) {
      try {
        await createTransactionNotification({
          supabase,
          userId,
          transaction: {
            transactionId: updated.id,
            type: updated.type,
            amount: Number(updated.amount),
            category: updated.category,
            merchant: updated.merchant,
            date: updated.date,
            channel: "manual",
          },
        });
      } catch (notificationError) {
        console.error("[movements] No se pudo crear la notificación:", notificationError);
      }
    }

    return { ok: true, transactionId: updated.id, alerts };
  });

export const deleteTransaction = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data: unknown) => z.object({ id: z.string().uuid() }).parse(data))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: existing, error: existingError } = await supabase
      .from("transactions")
      .select("id, type, amount, date, category, status")
      .eq("id", data.id)
      .eq("user_id", userId)
      .maybeSingle();

    if (existingError) throw new Error(existingError.message);
    if (!existing) throw new Error("El movimiento no existe o no pertenece al usuario.");

    const { error } = await supabase
      .from("transactions")
      .delete()
      .eq("id", data.id)
      .eq("user_id", userId);

    if (error) throw new Error(error.message);

    await applyMovementEffectsSafely(supabase, userId, [
      { before: toSnapshot(existing as PersistedTransaction), after: null },
    ]);

    return { ok: true };
  });

export const importTransactions = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data: unknown) => z.array(transactionInputSchema).max(1000).parse(data))
  .handler(async ({ data: importedItems, context }) => {
    const { supabase, userId } = context;

    if (importedItems.length === 0) {
      return { importedCount: 0, skippedCount: 0, alerts: [] };
    }

    const dates = Array.from(new Set(importedItems.map((item) => item.date)));
    const { data: existingTransactions, error } = await supabase
      .from("transactions")
      .select("date, amount, type, category, description, merchant, created_at")
      .eq("user_id", userId)
      .in("date", dates);

    if (error) throw new Error(error.message);

    const knownMovements: DuplicateMovement[] = [...(existingTransactions || [])];
    const budgetCategories = await loadUserBudgetCategories({ supabase, userId });
    const toInsert: Array<Database["public"]["Tables"]["transactions"]["Insert"]> = [];
    let skippedCount = 0;

    for (const item of importedItems) {
      const normalizedItem = {
        type: item.type,
        amount: item.amount,
        date: item.date,
        category: resolveCategoryFromBudgetSet(item.category, budgetCategories),
        description: item.description || null,
        merchant: item.merchant || null,
        created_at: item.created_at || null,
      };

      if (knownMovements.some((movement) => areMovementsDuplicates(movement, normalizedItem))) {
        skippedCount++;
        continue;
      }

      knownMovements.push(normalizedItem);
      toInsert.push({
        user_id: userId,
        ...normalizedItem,
        source: "excel_upload",
        status: item.status || "confirmed",
        created_at: item.created_at || new Date(`${item.date}T00:00:00Z`).toISOString(),
      });
    }

    if (toInsert.length === 0) {
      return { importedCount: 0, skippedCount, alerts: [] };
    }

    const { data: inserted, error: insertError } = await supabase
      .from("transactions")
      .insert(toInsert)
      .select("id, type, amount, date, category, status");

    if (insertError) throw new Error(insertError.message);

    const changes: MovementChange[] = (inserted || []).map((transaction) => ({
      before: null,
      after: toSnapshot(transaction as PersistedTransaction),
    }));
    const alerts = await applyMovementEffectsSafely(supabase, userId, changes);
    const importedCount = inserted?.length || 0;

    if (importedCount > 0 && inserted?.[0]?.id) {
      try {
        await createImportNotification({
          supabase,
          userId,
          summary: {
            importKey: `${inserted[0].id}:${importedCount}`,
            importedCount,
            skippedCount,
          },
        });
      } catch (notificationError) {
        console.error(
          "[movements] No se pudo crear la notificación de importación:",
          notificationError,
        );
      }
    }

    return {
      importedCount,
      skippedCount,
      alerts,
    };
  });
