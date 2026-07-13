import React from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  getNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  deleteNotification,
} from "@/lib/notifications.functions";
import { AlertTriangle, Bell, Info, CheckCheck, Trash2, Check } from "lucide-react";

export const Route = createFileRoute("/_authenticated/notifications")({
  component: NotificationsPage,
});

const LEVEL_STYLES: Record<string, { dot: string }> = {
  urgent: { dot: "bg-coral" },
  warning: { dot: "bg-gold" },
  info: { dot: "bg-[#7C6FE0]" },
};

const SOURCE_LABEL: Record<string, string> = {
  budget: "Presupuesto",
  ticket: "Soporte",
  chat_agent: "Kintu",
  transaction: "Movimiento",
  import: "Importación",
};

function NotificationsPage() {
  const getFn = useServerFn(getNotifications);
  const markReadFn = useServerFn(markNotificationRead);
  const markAllFn = useServerFn(markAllNotificationsRead);
  const deleteNotifFn = useServerFn(deleteNotification);
  const queryClient = useQueryClient();

  const q = useQuery({
    queryKey: ["notifications"],
    queryFn: () => getFn(),
    refetchInterval: 30000,
  });

  const markRead = useMutation({
    mutationFn: (id: string) => markReadFn({ data: { id } }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["notifications"] }),
  });

  const markAll = useMutation({
    mutationFn: () => markAllFn(),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["notifications"] }),
  });

  const deleteNotif = useMutation({
    mutationFn: (id: string) => deleteNotifFn({ data: { id } }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["notifications"] }),
  });

  const notifications = q.data?.notifications ?? [];
  const unreadCount = q.data?.unreadCount ?? 0;

  return (
    <div className="flex-1 w-full px-6 py-8 space-y-6 bg-[#F5F4FA] dark:bg-[#15132A] min-h-screen">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-foreground flex items-center gap-2">
            Notificaciones <Bell className="w-6 h-6 text-foreground" />
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            {unreadCount > 0 ? `Tenés ${unreadCount} sin leer.` : "Estás al día."}
          </p>
        </div>
        {unreadCount > 0 && (
          <button
            onClick={() => markAll.mutate()}
            disabled={markAll.isPending}
            className="flex items-center gap-2 px-4 py-2.5 rounded-full bg-white dark:bg-card border border-[#E4E0F5] dark:border-hairline shadow-sm text-sm font-semibold text-[#4C3A8C] dark:text-foreground hover:bg-[#F5F4FA] dark:hover:bg-card/70 transition-colors disabled:opacity-50"
          >
            <CheckCheck className="w-4 h-4" />
            Marcar todo como leído
          </button>
        )}
      </header>

      <div className="rounded-3xl bg-white dark:bg-card border border-[#E4E0F5] dark:border-hairline shadow-sm divide-y divide-[#E4E0F5] dark:divide-hairline overflow-hidden">
        {q.isLoading ? (
          <div className="p-8 text-center text-sm text-muted-foreground">Cargando...</div>
        ) : q.isError ? (
          <div className="p-10 text-center">
            <p className="text-sm font-semibold text-coral">
              No se pudieron cargar las notificaciones.
            </p>
            <button
              type="button"
              onClick={() => q.refetch()}
              className="mt-2 text-xs font-semibold text-[#4C3A8C] dark:text-[#B9A9F5] hover:underline"
            >
              Reintentar
            </button>
          </div>
        ) : notifications.length === 0 ? (
          <div className="p-10 text-center text-sm text-muted-foreground">
            Todavía no tenés notificaciones.
          </div>
        ) : (
          notifications.map((n) => {
            const style = LEVEL_STYLES[n.level] ?? LEVEL_STYLES.info;
            const isUnread = !n.read_at;
            return (
              <div
                key={n.id}
                className={`w-full flex items-start gap-3 px-6 py-4 transition-colors group relative ${
                  isUnread
                    ? "bg-[#7C6FE0]/5 dark:bg-[#7C6FE0]/10 hover:bg-[#7C6FE0]/10"
                    : "hover:bg-[#F5F4FA] dark:hover:bg-card/60"
                }`}
              >
                <span
                  className={`mt-1.5 w-2.5 h-2.5 rounded-full shrink-0 ${style.dot} ${isUnread ? "ring-2 ring-[#7C6FE0]/20" : "opacity-30"}`}
                />
                <div className="flex-1 min-w-0 pr-16">
                  <div className="flex items-center gap-2">
                    <span
                      className={`text-sm truncate ${isUnread ? "font-bold text-foreground" : "font-medium text-muted-foreground"}`}
                    >
                      {n.title}
                    </span>
                    <span className="text-[10px] uppercase tracking-wider text-muted-foreground/70 font-bold shrink-0">
                      {SOURCE_LABEL[n.source] ?? n.source}
                    </span>
                  </div>
                  <span className="block text-xs text-muted-foreground mt-0.5 leading-relaxed">
                    {n.message}
                  </span>
                  <span className="block text-[10px] text-muted-foreground/60 mt-1 tabular">
                    {new Date(n.created_at).toLocaleDateString("es-EC", {
                      day: "numeric",
                      month: "short",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </span>
                </div>
                <div className="absolute right-6 top-1/2 -translate-y-1/2 flex items-center gap-2">
                  {isUnread && (
                    <button
                      onClick={() => markRead.mutate(n.id)}
                      className="p-2 rounded-full text-muted-foreground hover:text-[#7C6FE0] hover:bg-muted"
                      title="Marcar como leído"
                    >
                      <Check className="w-4 h-4" />
                    </button>
                  )}
                  <button
                    onClick={() => deleteNotif.mutate(n.id)}
                    className="p-2 rounded-full text-muted-foreground hover:text-coral hover:bg-muted group-hover:opacity-100 opacity-0 transition-opacity"
                    title="Eliminar notificación"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
