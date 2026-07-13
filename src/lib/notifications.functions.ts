import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import type { Json } from "@/integrations/supabase/types";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type NotificationRow = {
  id: string;
  source: "budget" | "ticket" | "chat_agent" | "transaction" | "import";
  level: "info" | "warning" | "urgent";
  title: string;
  message: string;
  metadata: Json;
  event_key: string | null;
  related_alert_id: string | null;
  related_ticket_id: string | null;
  related_transaction_id: string | null;
  read_at: string | null;
  created_at: string;
};

export const getNotifications = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;

    const [itemsResult, countResult] = await Promise.all([
      supabase
        .from("notifications")
        .select(
          "id, source, level, title, message, metadata, event_key, related_alert_id, related_ticket_id, related_transaction_id, read_at, created_at",
        )
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(50),
      supabase
        .from("notifications")
        .select("id", { count: "exact", head: true })
        .eq("user_id", userId)
        .is("read_at", null),
    ]);

    if (itemsResult.error) throw new Error(itemsResult.error.message);
    if (countResult.error) throw new Error(countResult.error.message);

    return {
      notifications: (itemsResult.data || []) as NotificationRow[],
      unreadCount: countResult.count ?? 0,
    };
  });

export const markNotificationRead = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data: unknown) => z.object({ id: z.string().uuid() }).parse(data))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { error } = await supabase
      .from("notifications")
      .update({ read_at: new Date().toISOString() })
      .eq("id", data.id)
      .eq("user_id", userId);

    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const markAllNotificationsRead = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { error } = await supabase
      .from("notifications")
      .update({ read_at: new Date().toISOString() })
      .eq("user_id", userId)
      .is("read_at", null);

    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const deleteNotification = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data: unknown) => z.object({ id: z.string().uuid() }).parse(data))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: notification, error: readError } = await supabase
      .from("notifications")
      .select("related_alert_id")
      .eq("id", data.id)
      .eq("user_id", userId)
      .maybeSingle();

    if (readError) throw new Error(readError.message);

    if (notification?.related_alert_id) {
      const { error: alertError } = await supabase
        .from("alerts")
        .update({ acknowledged: true })
        .eq("id", notification.related_alert_id)
        .eq("user_id", userId);

      if (alertError) throw new Error(alertError.message);
    }

    const { error } = await supabase
      .from("notifications")
      .delete()
      .eq("id", data.id)
      .eq("user_id", userId);

    if (error) throw new Error(error.message);
    return { ok: true };
  });
