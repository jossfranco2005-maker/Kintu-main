import type { SupabaseClient } from "@supabase/supabase-js";

import type { ExpenseDraft, MissingExpenseField } from "@/lib/agents/schemas";

export type TransactionDraftStatus = "NEEDS_INFO" | "AWAITING_CONFIRMATION" | "SAVED" | "CANCELLED";

export type StoredTransactionDraft = ExpenseDraft & {
  id: string;
  userId: string;
  conversationId: string;
  status: TransactionDraftStatus;
  needs: MissingExpenseField[];
  transactionId: string | null;
};

type DraftRow = {
  id: string;
  user_id: string;
  conversation_id: string;
  type: "income" | "expense";
  amount: number | string | null;
  currency: string;
  date: string | null;
  category: string | null;
  merchant: string | null;
  description: string | null;
  status: TransactionDraftStatus;
  missing_fields: string[] | null;
  transaction_id: string | null;
};

function mapDraftRow(row: DraftRow): StoredTransactionDraft {
  return {
    id: row.id,
    userId: row.user_id,
    conversationId: row.conversation_id,
    type: row.type,
    amount: row.amount === null ? null : Number(row.amount),
    currency: "USD",
    date: row.date,
    category: row.category,
    merchant: row.merchant,
    description: row.description,
    status: row.status,
    needs: (row.missing_fields ?? []) as MissingExpenseField[],
    transactionId: row.transaction_id,
  };
}

export async function findActiveTransactionDraft(
  supabase: SupabaseClient,
  userId: string,
  conversationId: string,
): Promise<StoredTransactionDraft | null> {
  const { data, error } = await supabase
    .from("transaction_drafts")
    .select("*")
    .eq("user_id", userId)
    .eq("conversation_id", conversationId)
    .in("status", ["NEEDS_INFO", "AWAITING_CONFIRMATION"])
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(`No se pudo consultar el borrador: ${error.message}`);
  }

  return data ? mapDraftRow(data as DraftRow) : null;
}

export async function findTransactionDraftById(
  supabase: SupabaseClient,
  params: {
    id: string;
    userId: string;
    conversationId: string;
  },
): Promise<StoredTransactionDraft | null> {
  const { data, error } = await supabase
    .from("transaction_drafts")
    .select("*")
    .eq("id", params.id)
    .eq("user_id", params.userId)
    .eq("conversation_id", params.conversationId)
    .maybeSingle();

  if (error) {
    throw new Error(`No se pudo consultar el borrador: ${error.message}`);
  }

  return data ? mapDraftRow(data as DraftRow) : null;
}

export async function createTransactionDraft(
  supabase: SupabaseClient,
  params: {
    userId: string;
    conversationId: string;
    draft: ExpenseDraft;
    needs: MissingExpenseField[];
  },
): Promise<StoredTransactionDraft> {
  const status: TransactionDraftStatus =
    params.needs.length > 0 ? "NEEDS_INFO" : "AWAITING_CONFIRMATION";

  const { data, error } = await supabase
    .from("transaction_drafts")
    .insert({
      user_id: params.userId,
      conversation_id: params.conversationId,
      type: params.draft.type,
      amount: params.draft.amount,
      currency: "USD",
      date: params.draft.date,
      category: params.draft.category,
      merchant: params.draft.merchant,
      description: params.draft.description,
      status,
      missing_fields: params.needs,
      updated_at: new Date().toISOString(),
    })
    .select("*")
    .single();

  if (error || !data) {
    throw new Error(`No se pudo crear el borrador: ${error?.message ?? "respuesta vacía"}`);
  }

  return mapDraftRow(data as DraftRow);
}

export async function updateTransactionDraft(
  supabase: SupabaseClient,
  params: {
    id: string;
    userId: string;
    draft: ExpenseDraft;
    needs: MissingExpenseField[];
  },
): Promise<StoredTransactionDraft> {
  const status: TransactionDraftStatus =
    params.needs.length > 0 ? "NEEDS_INFO" : "AWAITING_CONFIRMATION";

  const { data, error } = await supabase
    .from("transaction_drafts")
    .update({
      type: params.draft.type,
      amount: params.draft.amount,
      date: params.draft.date,
      category: params.draft.category,
      merchant: params.draft.merchant,
      description: params.draft.description,
      status,
      missing_fields: params.needs,
      updated_at: new Date().toISOString(),
    })
    .eq("id", params.id)
    .eq("user_id", params.userId)
    .in("status", ["NEEDS_INFO", "AWAITING_CONFIRMATION"])
    .select("*")
    .single();

  if (error || !data) {
    throw new Error(`No se pudo actualizar el borrador: ${error?.message ?? "respuesta vacía"}`);
  }

  return mapDraftRow(data as DraftRow);
}

export async function markTransactionDraftSaved(
  supabase: SupabaseClient,
  params: {
    id: string;
    userId: string;
    transactionId: string;
  },
): Promise<void> {
  const now = new Date().toISOString();
  const { error } = await supabase
    .from("transaction_drafts")
    .update({
      status: "SAVED",
      transaction_id: params.transactionId,
      missing_fields: [],
      confirmed_at: now,
      updated_at: now,
    })
    .eq("id", params.id)
    .eq("user_id", params.userId)
    .in("status", ["NEEDS_INFO", "AWAITING_CONFIRMATION", "SAVED"]);

  if (error) {
    throw new Error(`No se pudo finalizar el borrador: ${error.message}`);
  }
}

export async function cancelTransactionDraft(
  supabase: SupabaseClient,
  params: {
    id: string;
    userId: string;
    conversationId?: string;
  },
): Promise<"cancelled" | "already_cancelled"> {
  let query = supabase
    .from("transaction_drafts")
    .select("id, status")
    .eq("id", params.id)
    .eq("user_id", params.userId);

  if (params.conversationId) {
    query = query.eq("conversation_id", params.conversationId);
  }

  const { data: current, error: readError } = await query.maybeSingle();

  if (readError) {
    throw new Error(`No se pudo consultar el borrador: ${readError.message}`);
  }

  if (!current) {
    throw new Error("El borrador no existe o no pertenece a esta conversación.");
  }

  if (current.status === "CANCELLED") {
    return "already_cancelled";
  }

  if (current.status === "SAVED") {
    throw new Error("La transacción ya fue confirmada y no puede descartarse.");
  }

  const now = new Date().toISOString();
  const { error } = await supabase
    .from("transaction_drafts")
    .update({
      status: "CANCELLED",
      cancelled_at: now,
      updated_at: now,
    })
    .eq("id", params.id)
    .eq("user_id", params.userId)
    .in("status", ["NEEDS_INFO", "AWAITING_CONFIRMATION"]);

  if (error) {
    throw new Error(`No se pudo cancelar el borrador: ${error.message}`);
  }

  return "cancelled";
}
