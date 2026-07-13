import { createServerFn } from "@tanstack/react-start";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import { cancelTransactionDraft } from "@/lib/agents/transaction-drafts.server";
import { processChatMessage } from "@/lib/agents/chat-flow.server";
import { firstTransactionWelcome } from "@/lib/agents/expense-draft";
import { saveConfirmedTransaction } from "@/lib/agents/orchestrator";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { syncBudgetCurrentState } from "@/lib/finance/movement-effects.server";

// IMPORTANTE: ya NO filtramos por channel. Un mismo usuario tiene una única
// conversación activa, sin importar si escribe desde la web o desde
// Telegram — así el historial queda unificado en ambos lados. El parámetro
// "channel" solo se usa para etiquetar la conversación la primera vez que
// se crea (si todavía no existe ninguna para ese usuario).
async function ensureConversation(
  supabase: SupabaseClient,
  userId: string,
  channel: string,
): Promise<string> {
  const { data: existing } = await supabase
    .from("conversations")
    .select("id")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (existing?.id) return existing.id;

  const { data: created, error } = await supabase
    .from("conversations")
    .insert({ user_id: userId, channel })
    .select("id")
    .single();

  if (error || !created) {
    throw new Error(error?.message || "No se pudo crear la conversación.");
  }

  return created.id;
}

export const sendMessage = createServerFn({ method: "POST" })
  .validator((data: unknown) =>
    z
      .object({
        text: z.string().trim().min(1).max(2000),
        channel: z.enum(["web", "whatsapp"]).default("web"),
      })
      .parse(data),
  )
  .middleware([requireSupabaseAuth])
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const conversationId = await ensureConversation(supabase, userId, data.channel);
    const { count: previousMessageCount, error: countError } = await supabase
      .from("messages")
      .select("id", { count: "exact", head: true })
      .eq("conversation_id", conversationId);

    if (countError) {
      throw new Error(countError.message);
    }

    const isFirstInteraction = (previousMessageCount ?? 0) === 0;

    const { error: userMessageError } = await supabase.from("messages").insert({
      conversation_id: conversationId,
      user_id: userId,
      role: "user",
      content: data.text,
    });

    if (userMessageError) {
      throw new Error(userMessageError.message);
    }

    const result = await processChatMessage({
      text: data.text,
      userId,
      supabase,
      conversationId,
    });

    const reply =
      isFirstInteraction && result.draft?.needs?.length
        ? firstTransactionWelcome(result.draft, result.reply)
        : result.reply;

    const { error: assistantMessageError } = await supabase.from("messages").insert({
      conversation_id: conversationId,
      user_id: userId,
      role: "assistant",
      content: reply,
      metadata: {
        draft: result.draft || null,
        draft_id: result.draft_id || null,
        cancelled_draft_id: result.cancelled_draft_id || null,
        ticket_id: result.ticket_id || null,
        citations: result.citations || null,
        // Bifurcación pendiente del agente de soporte (¿caso o
        // recomendación?). Se lee en el próximo turno vía
        // checkPendingSupportChoice, en support-flow.server.ts.
        support_choice_pending: result.supportChoicePending ?? null,
      },
    });

    if (assistantMessageError) {
      throw new Error(assistantMessageError.message);
    }

    return { ...result, reply, conversationId };
  });

export const confirmDraft = createServerFn({ method: "POST" })
  .validator((data: unknown) =>
    z
      .object({
        draftId: z.string().uuid(),
        conversationId: z.string().uuid(),
      })
      .parse(data),
  )
  .middleware([requireSupabaseAuth])
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const saved = await saveConfirmedTransaction({
      supabase,
      userId,
      conversationId: data.conversationId,
      draftId: data.draftId,
    });

    const kind = saved.draft.type === "income" ? "Ingreso" : "Gasto";
    const replyLines = [
      saved.alreadySaved
        ? `${kind} ya estaba guardado: USD ${saved.draft.amount.toFixed(2)} en ${saved.draft.category}.`
        : `${kind} guardado: USD ${saved.draft.amount.toFixed(2)} en ${saved.draft.category}.`,
    ];

    if (saved.alert) replyLines.push(saved.alert.message);
    const reply = replyLines.join(" ");

    // Solo crea un mensaje nuevo cuando esta solicitud insertó la transacción.
    // Los reintentos devuelven el mismo resultado sin ensuciar el historial.
    if (!saved.alreadySaved) {
      const { error: messageError } = await supabase.from("messages").insert({
        conversation_id: data.conversationId,
        user_id: userId,
        role: "assistant",
        content: reply,
        metadata: {
          alert: saved.alert || null,
          transaction_id: saved.transactionId,
          confirmed_draft_id: data.draftId,
        },
      });

      if (messageError) {
        throw new Error(messageError.message);
      }
    }

    return {
      transactionId: saved.transactionId,
      alert: saved.alert,
      reply,
      alreadySaved: saved.alreadySaved,
      draftId: data.draftId,
    };
  });

export const discardDraft = createServerFn({ method: "POST" })
  .validator((data: unknown) =>
    z
      .object({
        draftId: z.string().uuid(),
        conversationId: z.string().uuid(),
      })
      .parse(data),
  )
  .middleware([requireSupabaseAuth])
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const state = await cancelTransactionDraft(supabase, {
      id: data.draftId,
      userId,
      conversationId: data.conversationId,
    });
    const reply =
      state === "already_cancelled"
        ? "La transacción pendiente ya estaba descartada."
        : "Listo, descarté la transacción pendiente.";

    if (state === "cancelled") {
      const { error: messageError } = await supabase.from("messages").insert({
        conversation_id: data.conversationId,
        user_id: userId,
        role: "assistant",
        content: reply,
        metadata: { cancelled_draft_id: data.draftId },
      });

      if (messageError) {
        throw new Error(messageError.message);
      }
    }

    return { ok: true, state, reply, draftId: data.draftId };
  });

// ---- loadHistory ----
export const loadHistory = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const conversationId = await ensureConversation(supabase, userId, "web");
    const { data: messages } = await supabase
      .from("messages")
      .select("id, role, content, metadata, created_at")
      .eq("conversation_id", conversationId)
      .order("created_at", { ascending: true })
      .limit(200);
    return { conversationId, messages: messages || [] };
  });

// ---- seedDemoData: idempotent, only if user has no data ----
export const seedDemoData = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { count } = await supabase
      .from("transactions")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId);
    if ((count ?? 0) > 0) return { seeded: false };

    const today = new Date();
    const y = today.getUTCFullYear();
    const m = String(today.getUTCMonth() + 1).padStart(2, "0");
    const month = `${y}-${m}-01`;
    const day = (n: number) =>
      `${y}-${m}-${String(Math.max(1, today.getUTCDate() - n)).padStart(2, "0")}`;

    await supabase.from("transactions").insert([
      {
        user_id: userId,
        type: "income",
        amount: 800,
        date: day(20),
        category: "otros",
        description: "Salario primera quincena",
        source: "seed",
      },
      {
        user_id: userId,
        type: "income",
        amount: 200,
        date: day(5),
        category: "otros",
        description: "Trabajo extra",
        source: "seed",
      },
      {
        user_id: userId,
        type: "expense",
        amount: 45,
        date: day(15),
        category: "comida",
        merchant: "Mercado central",
        source: "seed",
      },
      {
        user_id: userId,
        type: "expense",
        amount: 12,
        date: day(10),
        category: "transporte",
        merchant: "Taxi",
        source: "seed",
      },
      {
        user_id: userId,
        type: "expense",
        amount: 60,
        date: day(8),
        category: "servicios",
        merchant: "Luz",
        source: "seed",
      },
      {
        user_id: userId,
        type: "expense",
        amount: 28,
        date: day(6),
        category: "comida",
        merchant: "Restaurante",
        source: "seed",
      },
      {
        user_id: userId,
        type: "expense",
        amount: 22,
        date: day(3),
        category: "entretenimiento",
        merchant: "Cine",
        source: "seed",
      },
      {
        user_id: userId,
        type: "expense",
        amount: 55,
        date: day(1),
        category: "comida",
        merchant: "Supermercado",
        source: "seed",
      },
    ]);

    const { data: budget, error: budgetError } = await supabase
      .from("budgets")
      .upsert(
        { user_id: userId, category: "comida", month, limit_amount: 200, alert_threshold: 0.8 },
        { onConflict: "user_id,category,month" },
      )
      .select("id")
      .single();

    if (budgetError || !budget) {
      throw new Error(budgetError?.message || "No se pudo crear el presupuesto de demostración.");
    }

    await syncBudgetCurrentState({ supabase, userId, budgetId: budget.id });

    return { seeded: true };
  });
