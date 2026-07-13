import type { SupabaseClient } from "@supabase/supabase-js";

import {
  buildImportNotification,
  buildTransactionNotification,
  type ImportNotificationInput,
  type TransactionNotificationInput,
} from "@/lib/notifications/transaction";

export async function createTransactionNotification(params: {
  supabase: SupabaseClient;
  userId: string;
  transaction: TransactionNotificationInput;
}): Promise<void> {
  const payload = buildTransactionNotification(params.transaction);
  const { error } = await params.supabase.from("notifications").upsert(
    {
      user_id: params.userId,
      ...payload,
    },
    { onConflict: "event_key", ignoreDuplicates: true },
  );

  if (error) {
    throw new Error(`No se pudo crear la notificación del movimiento: ${error.message}`);
  }
}

export async function createImportNotification(params: {
  supabase: SupabaseClient;
  userId: string;
  summary: ImportNotificationInput;
}): Promise<void> {
  const payload = buildImportNotification(params.summary);
  const { error } = await params.supabase.from("notifications").upsert(
    {
      user_id: params.userId,
      related_transaction_id: null,
      related_alert_id: null,
      related_ticket_id: null,
      ...payload,
    },
    { onConflict: "event_key", ignoreDuplicates: true },
  );

  if (error) {
    throw new Error(`No se pudo crear la notificación de importación: ${error.message}`);
  }
}
