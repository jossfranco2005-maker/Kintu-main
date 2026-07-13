import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  AlertTriangle,
  Bell,
  BookOpen,
  Check,
  ExternalLink,
  LifeBuoy,
  Mic,
  Send,
  X,
  Trash2,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { KintuAvatar } from "@/components/kintu/KintuAvatar";
import {
  confirmDraft,
  discardDraft,
  loadHistory,
  seedDemoData,
  sendMessage,
} from "@/lib/chat.functions";
import { acknowledgeAlerts, getSummary, listAlerts, listBudgets } from "@/lib/finance.functions";
import {
  getNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  deleteNotification,
  type NotificationRow,
} from "@/lib/notifications.functions";
import { createTelegramLinkToken, getTelegramLinkStatus } from "@/lib/telegram.functions";

export const Route = createFileRoute("/_authenticated/chat")({
  component: ChatPage,
});

type Draft = {
  type: "income" | "expense";
  amount: number | null;
  currency?: "USD";
  date: string | null;
  category: string | null;
  merchant: string | null;
  description: string | null;
  needs?: string[];
};

type Citation = {
  title: string;
  version: number;
  source: string;
};

type AlertMetadata = {
  message: string;
  level: "threshold" | "exceeded";
};

// Bifurcación pendiente del agente de soporte (¿caso o recomendación?).
// Solo se lee del lado del servidor (checkPendingSupportChoice); en el
// front no hace falta actuar sobre esto, el texto de la pregunta ya viene
// en message.content — se tipa acá nomás para no perder la forma del dato.
type SupportChoicePending = {
  pendingText: string;
};

type Message = {
  id: string;
  role: string;
  content: string;
  metadata: {
    draft?: Draft;
    draft_id?: string;
    confirmed_draft_id?: string;
    cancelled_draft_id?: string;
    ticket_id?: string;
    citations?: Citation[];
    support_choice_pending?: SupportChoicePending | null;
    alert?: AlertMetadata | null;
    transaction_id?: string;
  };
  created_at: string;
};

type BudgetItem = {
  id: string;
  category: string;
  spent: number;
  limit_amount: number;
};

const CATEGORY_LABEL: Record<string, string> = {
  comida: "Comida",
  transporte: "Transporte",
  servicios: "Servicios",
  entretenimiento: "Entretenimiento",
  salud: "Salud",
  hogar: "Hogar",
  educacion: "Educación",
  ropa: "Ropa",
  otros: "Otros",
};

type DraftCardStatus = "active" | "confirmed" | "cancelled";

type SpeechRecognitionAlternativeLike = {
  transcript: string;
};

type SpeechRecognitionResultLike = {
  isFinal: boolean;
  [index: number]: SpeechRecognitionAlternativeLike;
};

type SpeechRecognitionResultListLike = {
  length: number;
  [index: number]: SpeechRecognitionResultLike;
};

type SpeechRecognitionEventLike = {
  resultIndex: number;
  results: SpeechRecognitionResultListLike;
};

type SpeechRecognitionErrorEventLike = {
  error: string;
};

type SpeechRecognitionLike = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEventLike) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
};

type SpeechRecognitionConstructorLike = new () => SpeechRecognitionLike;

type SpeechRecognitionWindowLike = Window & {
  SpeechRecognition?: SpeechRecognitionConstructorLike;
  webkitSpeechRecognition?: SpeechRecognitionConstructorLike;
};

// A veces un fallo del servidor (500, timeout, etc.) no devuelve un error
// normal sino la página de error HTML completa de Vite/TanStack Start, y
// esa termina siendo error.message. Si se la muestra tal cual en un toast,
// el usuario ve el código fuente de una página entera en vez de un mensaje.
// Esta función detecta ese caso y lo reemplaza por algo legible.
function friendlyErrorMessage(
  error: unknown,
  fallback = "Hubo un problema. Probá de nuevo en un momento.",
): string {
  const raw = error instanceof Error ? error.message : "";
  const looksLikeHtml = !raw || /<!doctype html|<html[\s>]/i.test(raw);
  return looksLikeHtml ? fallback : raw;
}

/**
 * Dictado en vivo con la Web Speech API del navegador.
 * No sube audio a ningún lado: el propio navegador transcribe localmente
 * (o vía su motor de reconocimiento) y nos entrega texto incremental.
 * Soporte real: Chrome/Edge (completo), Safari (parcial), Firefox (nulo).
 */
function useSpeechToText(onTranscript: (text: string, isFinal: boolean) => void) {
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const ctorRef = useRef<SpeechRecognitionConstructorLike | null>(null);
  // Intención del usuario (¿quiere seguir escuchando?), separada del estado
  // real del navegador — el navegador puede cortar la sesión solo (silencio
  // prolongado, timeout interno) sin que el usuario haya tocado nada.
  const shouldListenRef = useRef(false);
  const onTranscriptRef = useRef(onTranscript);
  onTranscriptRef.current = onTranscript;

  // Cuenta reinicios automáticos seguidos sin ningún resultado real, para
  // no entrar en loop infinito si el problema es de permisos o de red.
  const autoRestartCountRef = useRef(0);
  const gotAnyResultRef = useRef(false);

  const [isListening, setIsListening] = useState(false);
  const [isSupported, setIsSupported] = useState(true);

  useEffect(() => {
    const speechWindow = window as SpeechRecognitionWindowLike;
    const Ctor = speechWindow.SpeechRecognition || speechWindow.webkitSpeechRecognition;
    if (!Ctor) {
      setIsSupported(false);
      return;
    }
    ctorRef.current = Ctor;

    return () => {
      shouldListenRef.current = false;
      try {
        recognitionRef.current?.abort();
      } catch {
        // no-op
      }
    };
  }, []);

  function createRecognition(): SpeechRecognitionLike {
    const Ctor = ctorRef.current;
    if (!Ctor) {
      throw new Error("El reconocimiento de voz no está disponible.");
    }

    const recognition = new Ctor();
    recognition.lang = "es-EC";
    recognition.continuous = true;
    recognition.interimResults = true;

    recognition.onresult = (event: SpeechRecognitionEventLike) => {
      if (recognitionRef.current !== recognition) return;

      gotAnyResultRef.current = true;
      autoRestartCountRef.current = 0;

      let finalTranscript = "";
      let interimTranscript = "";

      for (let i = event.resultIndex; i < event.results.length; i++) {
        const transcript = event.results[i][0].transcript;
        if (event.results[i].isFinal) {
          finalTranscript += transcript;
        } else {
          interimTranscript += transcript;
        }
      }

      if (finalTranscript) onTranscriptRef.current(finalTranscript, true);
      else if (interimTranscript) onTranscriptRef.current(interimTranscript, false);
    };

    recognition.onerror = (event: SpeechRecognitionErrorEventLike) => {
      if (recognitionRef.current !== recognition) return;
      if (event.error === "no-speech" || event.error === "aborted") return;

      if (event.error === "not-allowed" || event.error === "service-not-allowed") {
        shouldListenRef.current = false;
        toast.error(
          "El navegador no tiene permiso para usar el micrófono. Habilitalo en la configuración del sitio y volvé a intentar.",
        );
        return;
      }

      toast.error("No se pudo captar el audio. Probá de nuevo.");
    };

    recognition.onend = () => {
      // Ignorar el onend de una instancia ya reemplazada (puede llegar
      // tarde, después de que start() ya creó y activó una nueva).
      if (recognitionRef.current !== recognition) return;

      // Si el usuario seguía queriendo dictar, el corte fue del navegador
      // (no un stop() explícito) — reiniciamos con una instancia nueva para
      // que la frase no se pierda a mitad de camino. Pero si nunca llegó
      // ningún resultado real y esto se repite, algo de fondo está fallando
      // (permisos, red) — cortamos en vez de reintentar para siempre.
      if (shouldListenRef.current) {
        if (!gotAnyResultRef.current) {
          autoRestartCountRef.current += 1;
        }

        if (autoRestartCountRef.current > 3) {
          shouldListenRef.current = false;
          setIsListening(false);
          toast.error(
            "No se pudo captar el micrófono. Revisá los permisos del navegador para este sitio.",
          );
          return;
        }

        try {
          const fresh = createRecognition();
          recognitionRef.current = fresh;
          fresh.start();
          return;
        } catch {
          // si falla el reinicio, caemos al estado "detenido" de abajo
        }
      }
      shouldListenRef.current = false;
      setIsListening(false);
    };

    return recognition;
  }

  const start = async () => {
    if (!isSupported) {
      toast.error("Tu navegador no soporta dictado por voz. Probá con Chrome.");
      return;
    }

    // Pedimos permiso de micrófono explícitamente primero: si el usuario
    // ya lo negó antes, esto da un mensaje claro en vez de que el
    // reconocimiento falle en silencio una y otra vez.
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((track) => track.stop());
    } catch {
      toast.error(
        "No se pudo acceder al micrófono. Revisá que el sitio tenga permiso en la configuración del navegador.",
      );
      return;
    }

    // Si quedó una sesión anterior colgada (por error o corte raro), la
    // descartamos antes de arrancar una limpia.
    try {
      recognitionRef.current?.abort();
    } catch {
      // no-op
    }

    shouldListenRef.current = true;
    autoRestartCountRef.current = 0;
    gotAnyResultRef.current = false;
    const recognition = createRecognition();
    recognitionRef.current = recognition;

    try {
      recognition.start();
      setIsListening(true);
    } catch {
      shouldListenRef.current = false;
      setIsListening(false);
      toast.error("No se pudo iniciar el dictado. Probá de nuevo.");
    }
  };

  const stop = () => {
    shouldListenRef.current = false;
    try {
      recognitionRef.current?.stop();
    } catch {
      // no-op
    }
    setIsListening(false);
  };

  return { isListening, isSupported, start, stop };
}

function UnsupportedSpeechNotice() {
  return (
    <div className="shrink-0 max-w-[220px] rounded-xl border border-amber-200 bg-amber-50 dark:bg-amber-400/10 dark:border-amber-400/20 px-3 py-2 text-xs text-amber-800 dark:text-amber-200 leading-snug">
      <p className="font-semibold flex items-center gap-1">
        <Mic className="w-3.5 h-3.5 shrink-0" />
        Dictado no disponible
      </p>
      <p className="mt-0.5">
        Tu navegador no soporta dictado por voz. Funciona en{" "}
        <span className="font-medium">Chrome, Edge</span> y{" "}
        <span className="font-medium">Safari (parcial)</span>. Escribí tu mensaje abajo.
      </p>
    </div>
  );
}

function ChatPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const send = useServerFn(sendMessage);
  const confirm = useServerFn(confirmDraft);
  const discard = useServerFn(discardDraft);
  const history = useServerFn(loadHistory);
  const seed = useServerFn(seedDemoData);
  const summaryFn = useServerFn(getSummary);
  const budgetsFn = useServerFn(listBudgets);
  const alertsFn = useServerFn(listAlerts);
  const acknowledgeFn = useServerFn(acknowledgeAlerts);
  const getNotificationsFn = useServerFn(getNotifications);
  const markAllReadFn = useServerFn(markAllNotificationsRead);
  const markReadFn = useServerFn(markNotificationRead);
  const deleteNotifFn = useServerFn(deleteNotification);
  const createTelegramLinkFn = useServerFn(createTelegramLinkToken);
  const telegramStatusFn = useServerFn(getTelegramLinkStatus);

  const [text, setText] = useState("");
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [locallyConfirmed, setLocallyConfirmed] = useState<Set<string>>(() => new Set());
  const [locallyCancelled, setLocallyCancelled] = useState<Set<string>>(() => new Set());
  const seenAlertIds = useRef<Set<string>>(new Set());
  const seenInitialized = useRef(false);
  const feedRef = useRef<HTMLDivElement>(null);

  // Guarda lo que ya estaba escrito en el textarea antes de empezar a
  // dictar, para no pisarlo — el dictado se agrega a continuación.
  const baseTextRef = useRef("");

  const { isListening, isSupported, start, stop } = useSpeechToText((transcript, isFinal) => {
    setText(baseTextRef.current + (baseTextRef.current ? " " : "") + transcript);
    if (isFinal) {
      baseTextRef.current = baseTextRef.current + (baseTextRef.current ? " " : "") + transcript;
    }
  });

  function handleMicClick() {
    if (isListening) {
      stop();
    } else {
      baseTextRef.current = text;
      start();
    }
  }

  const historyQuery = useQuery({
    queryKey: ["chat", "history"],
    queryFn: () => history(),
    // Telegram escribe en la misma conversación. Este sondeo mantiene el
    // historial web sincronizado sin exigir una suscripción Realtime.
    refetchInterval: 3_000,
  });
  const summaryQuery = useQuery({
    queryKey: ["finance", "summary"],
    queryFn: () => summaryFn(),
  });
  const budgetsQuery = useQuery({
    queryKey: ["finance", "budgets"],
    queryFn: () => budgetsFn(),
  });
  const alertsQuery = useQuery({
    queryKey: ["finance", "alerts"],
    queryFn: () => alertsFn(),
    refetchInterval: 15_000,
  });
  const notificationsQuery = useQuery({
    queryKey: ["notifications"],
    queryFn: () => getNotificationsFn(),
    refetchInterval: 12_000,
  });
  const telegramStatusQuery = useQuery({
    queryKey: ["telegram", "status"],
    queryFn: () => telegramStatusFn(),
    refetchInterval: 5_000,
  });

  useEffect(() => {
    const alerts = alertsQuery.data?.alerts ?? [];
    if (!seenInitialized.current) {
      alerts.forEach((alert) => seenAlertIds.current.add(alert.id));
      seenInitialized.current = true;
      return;
    }

    for (const alert of alerts) {
      if (seenAlertIds.current.has(alert.id)) continue;
      seenAlertIds.current.add(alert.id);
      if (alert.acknowledged) continue;
      if (alert.level === "exceeded") toast.error(alert.message);
      else toast(alert.message, { icon: "🌾" });
    }
  }, [alertsQuery.data?.alerts]);

  const acknowledgeMutation = useMutation({
    mutationFn: (ids?: string[]) => acknowledgeFn({ data: { ids } }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["finance", "alerts"] }),
  });

  const markAllReadMutation = useMutation({
    mutationFn: () => markAllReadFn(),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["notifications"] }),
  });

  const markReadMutation = useMutation({
    mutationFn: (id: string) => markReadFn({ data: { id } }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["notifications"] }),
  });

  const deleteNotificationMutation = useMutation({
    mutationFn: (id: string) => deleteNotifFn({ data: { id } }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["notifications"] }),
  });

  const seedMutation = useMutation({
    mutationFn: () => seed(),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["finance"] });
      queryClient.invalidateQueries({ queryKey: ["notifications"] });
      toast(
        result.seeded
          ? "Cargué datos ficticios de demostración. Puedes verlos en Movimientos."
          : "Tu cuenta ya tiene movimientos; no se agregaron datos demo.",
        { icon: "🌱" },
      );
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "No se pudieron cargar los datos demo."),
  });

  const sendMutation = useMutation({
    mutationFn: (message: string) => send({ data: { text: message, channel: "web" } }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["chat", "history"] });
      queryClient.invalidateQueries({ queryKey: ["finance"] });
      queryClient.invalidateQueries({ queryKey: ["notifications"] });
    },
    onError: (error) => toast.error(friendlyErrorMessage(error)),
  });

  const confirmMutation = useMutation({
    mutationFn: (params: { draftId: string; conversationId: string }) =>
      confirm({
        data: {
          draftId: params.draftId,
          conversationId: params.conversationId,
        },
      }),
    onSuccess: (result) => {
      setLocallyConfirmed((current) => new Set(current).add(result.draftId));
      queryClient.invalidateQueries({ queryKey: ["chat", "history"] });
      queryClient.invalidateQueries({ queryKey: ["finance"] });
      queryClient.invalidateQueries({ queryKey: ["notifications"] });

      if (result.alreadySaved) {
        toast("La transacción ya estaba confirmada.");
      }
      if (result.alert) {
        if (result.alert.level === "exceeded") toast.error(result.alert.message);
        else toast(result.alert.message, { icon: "🌾" });
      }
    },
    onError: (error) => toast.error(friendlyErrorMessage(error)),
  });

  const discardMutation = useMutation({
    mutationFn: (params: { draftId: string; conversationId: string }) =>
      discard({
        data: {
          draftId: params.draftId,
          conversationId: params.conversationId,
        },
      }),
    onSuccess: (result) => {
      setLocallyCancelled((current) => new Set(current).add(result.draftId));
      queryClient.invalidateQueries({ queryKey: ["chat", "history"] });
      toast(result.reply);
    },
    onError: (error) => toast.error(friendlyErrorMessage(error)),
  });

  const telegramLinkMutation = useMutation({
    mutationFn: () => createTelegramLinkFn(),
    onSuccess: (result) => {
      window.open(result.link, "_blank");
    },
    onError: (error) =>
      toast.error(friendlyErrorMessage(error, "No se pudo generar el enlace. Probá de nuevo.")),
  });

  useEffect(() => {
    feedRef.current?.scrollTo({
      top: feedRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [historyQuery.data?.messages, sendMutation.isPending]);

  function handleSend(event?: React.FormEvent) {
    event?.preventDefault();
    const message = text.trim();
    if (!message || sendMutation.isPending) return;
    if (isListening) stop();
    setText("");
    baseTextRef.current = "";
    sendMutation.mutate(message);
  }

  const messages = useMemo(
    () => (historyQuery.data?.messages ?? []) as Message[],
    [historyQuery.data?.messages],
  );
  const conversationId = historyQuery.data?.conversationId;
  const alerts = alertsQuery.data?.alerts ?? [];
  const unreadCount = alertsQuery.data?.unread ?? 0;
  const notifications = notificationsQuery.data?.notifications ?? [];
  const notifUnreadCount = notificationsQuery.data?.unreadCount ?? 0;

  // Mismo cálculo de nivel/ahorro que alimenta el árbol del sidebar, para
  // que ambas versiones (mini y grande) muestren siempre el mismo estado.
  const income = summaryQuery.data?.income ?? 0;
  const expense = summaryQuery.data?.expense ?? 0;
  const savingsRate =
    income > 0 ? Math.max(0, Math.min(100, ((income - expense) / income) * 100)) : 0;

  const confirmedDraftIds = useMemo(() => {
    const ids = new Set(locallyConfirmed);
    for (const message of messages) {
      if (message.metadata?.confirmed_draft_id) {
        ids.add(message.metadata.confirmed_draft_id);
      }
    }
    return ids;
  }, [locallyConfirmed, messages]);

  const cancelledDraftIds = useMemo(() => {
    const ids = new Set(locallyCancelled);
    for (const message of messages) {
      if (message.metadata?.cancelled_draft_id) {
        ids.add(message.metadata.cancelled_draft_id);
      }
    }
    return ids;
  }, [locallyCancelled, messages]);

  const latestDraftMessageIds = useMemo(() => {
    const latest = new Map<string, string>();
    for (const message of messages) {
      const draftId = message.metadata?.draft_id;
      if (draftId && message.metadata?.draft) latest.set(draftId, message.id);
    }
    return latest;
  }, [messages]);

  return (
    <div className="w-full grid md:grid-cols-[1fr_340px] gap-4 px-4 py-4 h-screen max-h-screen overflow-hidden">
      <div className="flex flex-col min-h-0 h-full rounded-2xl border border-hairline bg-card overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-hairline relative shrink-0">
          <div className="flex items-center gap-2">
            <span className="w-8 h-8 rounded-full bg-[#7C6FE0] text-white text-sm font-bold flex items-center justify-center shrink-0">
              K
            </span>
            <div>
              <p className="text-sm font-semibold text-foreground leading-tight">Kintu</p>
              <p className="text-xs text-muted-foreground leading-tight">Tu libreta inteligente</p>
            </div>
          </div>

          <div className="flex items-center">
            <button
              type="button"
              onClick={() => telegramLinkMutation.mutate()}
              disabled={telegramLinkMutation.isPending || telegramStatusQuery.data?.connected}
              className={`mr-1 flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
                telegramStatusQuery.data?.connected
                  ? "bg-[#7C6FE0]/10 text-[#7C6FE0] cursor-default"
                  : "bg-muted text-foreground hover:bg-muted/70"
              }`}
            >
              <Send className="w-3.5 h-3.5" />
              {telegramStatusQuery.data?.connected
                ? "Telegram conectado"
                : telegramLinkMutation.isPending
                  ? "Generando enlace..."
                  : "Conectar Telegram"}
            </button>

            <button
              type="button"
              aria-label={`Notificaciones${notifUnreadCount ? ` (${notifUnreadCount} sin leer)` : ""}`}
              onClick={() => setNotificationsOpen((current) => !current)}
              className="relative rounded-full p-2 hover:bg-muted transition-colors"
            >
              <Bell className="w-5 h-5 text-foreground" />
              {notifUnreadCount > 0 && (
                <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 rounded-full bg-coral text-white text-[10px] font-medium flex items-center justify-center">
                  {notifUnreadCount > 9 ? "9+" : notifUnreadCount}
                </span>
              )}
            </button>
          </div>

          {notificationsOpen && (
            <div className="absolute right-3 top-full mt-1 w-80 max-h-96 overflow-y-auto rounded-xl border border-hairline bg-card shadow-xl z-10">
              <div className="p-3 border-b border-hairline flex items-center justify-between sticky top-0 bg-card z-10">
                <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-1">
                  🔔 Notificaciones
                </span>
                <div className="flex items-center gap-2">
                  {notifUnreadCount > 0 && (
                    <button
                      type="button"
                      onClick={() => markAllReadMutation.mutate()}
                      className="text-[10px] text-[#7C6FE0] underline-offset-2 hover:underline"
                    >
                      Marcar leídas
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => setNotificationsOpen(false)}
                    aria-label="Cerrar"
                    className="text-muted-foreground hover:text-foreground"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {notificationsQuery.isError ? (
                <div className="p-6 text-center">
                  <p className="text-sm font-semibold text-coral">
                    No pude cargar las notificaciones.
                  </p>
                  <button
                    type="button"
                    onClick={() => notificationsQuery.refetch()}
                    className="mt-2 text-xs text-[#7C6FE0] hover:underline"
                  >
                    Reintentar
                  </button>
                </div>
              ) : notifications.length === 0 ? (
                <div className="p-6 text-center">
                  <p className="text-2xl mb-1">🌿</p>
                  <p className="text-sm text-muted-foreground">Todo tranquilo por aquí.</p>
                </div>
              ) : (
                <ul className="divide-y divide-hairline">
                  {notifications.map((notif: NotificationRow) => {
                    const dotColor =
                      notif.level === "urgent"
                        ? "bg-coral"
                        : notif.level === "warning"
                          ? "bg-gold"
                          : "bg-[#7C6FE0]";
                    const bg =
                      notif.level === "urgent"
                        ? "bg-coral/8"
                        : notif.level === "warning"
                          ? "bg-gold/8"
                          : "bg-[#7C6FE0]/5";
                    const unread = !notif.read_at;
                    return (
                      <li
                        key={notif.id}
                        onClick={() => {
                          if (unread) markReadMutation.mutate(notif.id);
                          navigate({ to: "/notifications" });
                        }}
                        className={`p-3 text-sm flex items-start gap-2.5 transition-colors relative group cursor-pointer ${bg} ${unread ? "border-l-2 border-l-[#7C6FE0]" : ""}`}
                      >
                        <span
                          className={`mt-1.5 w-2.5 h-2.5 rounded-full shrink-0 ${dotColor} ${unread ? "" : "opacity-30"}`}
                        />
                        <div className="flex-1 min-w-0 pr-6">
                          <p className="font-semibold text-foreground leading-snug">
                            {notif.title}
                          </p>
                          <p className="text-muted-foreground mt-0.5 leading-snug">
                            {notif.message}
                          </p>
                          <p className="text-[10px] text-muted-foreground/60 mt-1">
                            {new Date(notif.created_at).toLocaleString("es-EC", {
                              day: "numeric",
                              month: "short",
                              hour: "2-digit",
                              minute: "2-digit",
                            })}
                          </p>
                        </div>
                        <div className="absolute right-2 top-2 flex items-center gap-1.5">
                          {unread && (
                            <span className="w-2 h-2 rounded-full bg-[#7C6FE0] shrink-0" />
                          )}
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              deleteNotificationMutation.mutate(notif.id);
                            }}
                            className="p-1 rounded text-muted-foreground hover:text-coral hover:bg-muted opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity"
                            title="Eliminar notificación"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          )}
        </div>

        {/* Message feed - contained, own scroll, never stretches the page */}
        <div ref={feedRef} className="flex-1 overflow-y-auto px-4 py-4 space-y-3 bg-background/40">
          {messages.length === 0 && (
            <div className="text-center py-16">
              <p className="font-serif text-2xl text-foreground">Hola.</p>
              <p className="mt-2 text-sm text-muted-foreground max-w-xs mx-auto">
                Contame en qué gastaste o qué querés revisar. Por ejemplo:
                <br />
                <span className="italic">"gasté 12 en almuerzo"</span> ·{" "}
                <span className="italic">"¿cuánto llevo este mes?"</span>
              </p>
              <button
                type="button"
                onClick={() => seedMutation.mutate()}
                disabled={seedMutation.isPending}
                className="mt-5 inline-flex items-center justify-center rounded-full border border-[#7C6FE0]/25 bg-[#7C6FE0]/8 px-4 py-2 text-xs font-semibold text-[#4C3A8C] hover:bg-[#7C6FE0]/15 disabled:opacity-50 dark:text-[#B9A9F5]"
              >
                {seedMutation.isPending ? "Cargando ejemplo..." : "Cargar datos demo (opcional)"}
              </button>
            </div>
          )}

          {messages.map((message) => {
            const draftId = message.metadata?.draft_id;
            let status: DraftCardStatus = "active";
            if (draftId && confirmedDraftIds.has(draftId)) status = "confirmed";
            if (draftId && cancelledDraftIds.has(draftId)) status = "cancelled";

            return (
              <MessageRow
                key={message.id}
                message={message}
                status={status}
                showDraftCard={!draftId || latestDraftMessageIds.get(draftId) === message.id}
                confirming={
                  confirmMutation.isPending && confirmMutation.variables?.draftId === draftId
                }
                discarding={
                  discardMutation.isPending && discardMutation.variables?.draftId === draftId
                }
                onConfirm={(selectedDraftId) => {
                  if (!conversationId) return;
                  confirmMutation.mutate({
                    draftId: selectedDraftId,
                    conversationId,
                  });
                }}
                onDiscard={(selectedDraftId) => {
                  if (!conversationId) return;
                  discardMutation.mutate({
                    draftId: selectedDraftId,
                    conversationId,
                  });
                }}
              />
            );
          })}

          {sendMutation.isPending && (
            <div className="flex items-end gap-2">
              <span className="w-7 h-7 rounded-full bg-[#7C6FE0] text-white text-xs font-bold flex items-center justify-center shrink-0">
                K
              </span>
              <div className="rounded-2xl rounded-bl-sm bg-card border border-hairline px-4 py-2.5 text-sm text-muted-foreground italic">
                Kintu está escribiendo...
              </div>
            </div>
          )}
        </div>

        {/* Composer */}
        <form
          onSubmit={handleSend}
          className="border-t border-hairline px-3 py-3 flex items-end gap-2 shrink-0 bg-card"
        >
          {isSupported ? (
            <div className="relative shrink-0">
              <button
                type="button"
                aria-label={isListening ? "Detener grabación" : "Dictar mensaje"}
                onClick={handleMicClick}
                className={`shrink-0 min-w-[48px] min-h-[48px] rounded-full text-white flex items-center justify-center shadow-md hover:opacity-90 transition-colors ${
                  isListening ? "bg-rose-500 animate-pulse" : "bg-[#7C6FE0]"
                }`}
              >
                <Mic className="w-5 h-5" />
              </button>
              {isListening && (
                <span className="absolute bottom-full left-0 mb-1.5 whitespace-nowrap rounded-full bg-foreground text-background text-[11px] font-medium px-2.5 py-1 shadow-sm">
                  Presioná para dejar de grabar
                </span>
              )}
            </div>
          ) : (
            <UnsupportedSpeechNotice />
          )}
          <textarea
            value={text}
            onChange={(event) => setText(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                handleSend();
              }
            }}
            placeholder={
              isListening ? "Escuchando..." : "Escribí lo que gastaste o preguntá algo..."
            }
            rows={1}
            className="flex-1 min-h-[48px] max-h-40 resize-none px-3 py-3 rounded-xl border border-input bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            autoFocus
          />
          <button
            type="submit"
            disabled={!text.trim() || sendMutation.isPending}
            aria-label="Enviar"
            className="shrink-0 min-w-[48px] min-h-[48px] rounded-xl bg-[#7C6FE0] text-white flex items-center justify-center disabled:opacity-50"
          >
            <Send className="w-5 h-5" />
          </button>
        </form>
      </div>

      {/* Sidebar derecho — tamaño natural, con scroll propio si no cabe,
          igual que el sidebar principal de la app. */}
      <aside className="hidden md:flex flex-col gap-4 min-h-0 h-full overflow-y-auto">
        <div className="rounded-2xl border border-hairline bg-card p-5 flex flex-col shrink-0">
          <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-bold">
            Balance del mes
          </p>
          <p className="mt-1 font-serif text-3xl tabular text-foreground">
            USD {(summaryQuery.data?.net ?? 0).toFixed(2)}
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground tabular">
            +{(summaryQuery.data?.income ?? 0).toFixed(0)} / -
            {(summaryQuery.data?.expense ?? 0).toFixed(0)}
          </p>

          {/* Árbol Kintu — versión "hero": solo el personaje, grande y con
              un balanceo suave, sin texto ni nivel debajo (esos ya viven
              en el mini-widget del sidebar).
              IMPORTANTE: le pasamos incomes/expenses/incomeCount/expenseCount
              para que el propio componente pueda detectar cuándo hubo un
              movimiento nuevo y disparar la animación — sin estas props
              el avatar no tiene con qué comparar y nunca anima. */}
          <div className="mt-4 relative overflow-hidden rounded-3xl bg-gradient-to-br from-[#4C3A8C] via-[#5F4FB0] to-[#7C6FE0] shadow-lg py-8 flex items-center justify-center">
            <style>{`
              @keyframes kintuSway {
                0%, 100% { transform: translateY(0) rotate(-2deg); }
                50% { transform: translateY(-10px) rotate(2deg); }
              }
              .kintu-sway { animation: kintuSway 4.5s ease-in-out infinite; transform-origin: bottom center; }
            `}</style>
            {/* glow decorativo */}
            <div className="pointer-events-none absolute -top-10 -right-10 w-40 h-40 rounded-full bg-white/10 blur-2xl" />
            <div className="pointer-events-none absolute -bottom-14 -left-10 w-36 h-36 rounded-full bg-white/10 blur-2xl" />

            <div className="kintu-sway relative">
              <KintuAvatar
                savingsRate={savingsRate}
                incomes={income}
                expenses={expense}
                incomeCount={summaryQuery.data?.incomeCount ?? 0}
                expenseCount={summaryQuery.data?.expenseCount ?? 0}
                size={168}
              />
            </div>
          </div>
        </div>

        {/* Presupuestos del mes */}
        {budgetsQuery.data?.budgets && budgetsQuery.data.budgets.length > 0 && (
          <div className="rounded-2xl border border-hairline bg-card p-4 space-y-4 shrink-0">
            <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-bold">
              Presupuestos del mes
            </p>
            <div className="space-y-3">
              {(budgetsQuery.data.budgets as BudgetItem[]).map((budget) => {
                const spent = Number(budget.spent);
                const limit = Number(budget.limit_amount);
                const pct = limit > 0 ? Math.min(100, (spent / limit) * 100) : 0;
                const over = spent > limit;
                return (
                  <div key={budget.id}>
                    <div className="flex items-center justify-between text-xs mb-1">
                      <span className="font-medium text-foreground">
                        {CATEGORY_LABEL[budget.category] ?? budget.category}
                      </span>
                      <span
                        className={`tabular ${over ? "text-rose-500 font-semibold" : "text-muted-foreground"}`}
                      >
                        USD {spent.toFixed(0)} / {limit.toFixed(0)}
                      </span>
                    </div>
                    <div className="h-1.5 rounded-full bg-gray-100 dark:bg-white/10 overflow-hidden">
                      <div
                        className={`h-full rounded-full ${over ? "bg-rose-500" : "bg-[#7C6FE0]"}`}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    {over && (
                      <p className="mt-1 flex items-center gap-1 text-[10px] text-rose-500">
                        <AlertTriangle className="w-3 h-3 shrink-0" />
                        Superado
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </aside>
    </div>
  );
}

function MessageRow({
  message,
  status,
  showDraftCard,
  onConfirm,
  onDiscard,
  confirming,
  discarding,
}: {
  message: Message;
  status: DraftCardStatus;
  showDraftCard: boolean;
  onConfirm: (draftId: string) => void;
  onDiscard: (draftId: string) => void;
  confirming: boolean;
  discarding: boolean;
}) {
  const isUser = message.role === "user";
  const draft = message.metadata?.draft;
  const draftId = message.metadata?.draft_id;
  const readyDraft =
    Boolean(draftId) &&
    Boolean(draft) &&
    (!draft?.needs || draft.needs.length === 0) &&
    typeof draft?.amount === "number" &&
    Boolean(draft?.date) &&
    Boolean(draft?.category) &&
    Boolean(draft?.merchant);
  const alert = message.metadata?.alert;
  const citations = message.metadata?.citations;

  // Bifurcación caso vs. recomendación: ticket_id y citations son
  // mutuamente excluyentes en la práctica (el orquestador solo llena uno
  // de los dos por turno), así que alcanza con chequear cuál vino.
  const isTicketMessage = !isUser && Boolean(message.metadata?.ticket_id);
  const isFinancialAdvice = !isUser && Boolean(citations && citations.length > 0);

  const bubbleClass = isUser
    ? "bg-muted text-foreground rounded-br-sm"
    : isTicketMessage
      ? "bg-amber-50 border border-amber-200 text-foreground rounded-bl-sm dark:bg-amber-400/10 dark:border-amber-400/25"
      : isFinancialAdvice
        ? "bg-[#7C6FE0]/8 border border-[#7C6FE0]/25 text-foreground rounded-bl-sm"
        : "bg-card border border-hairline text-foreground rounded-bl-sm";

  return (
    <div className={`flex flex-col gap-1.5 ${isUser ? "items-end" : "items-start"}`}>
      {/* Bubble row */}
      <div className={`flex items-end gap-2 max-w-[85%] ${isUser ? "flex-row-reverse" : ""}`}>
        {!isUser && (
          <span className="w-7 h-7 rounded-full bg-[#7C6FE0] text-white text-xs font-bold flex items-center justify-center shrink-0 mb-0.5">
            K
          </span>
        )}
        <div className="flex flex-col gap-1">
          {isTicketMessage && (
            <span className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-300">
              <LifeBuoy className="w-3 h-3" />
              Caso abierto
            </span>
          )}
          {isFinancialAdvice && (
            <span className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-[#4C3A8C] dark:text-[#B9A9F5]">
              <BookOpen className="w-3 h-3" />
              Recomendación financiera
            </span>
          )}
          <div
            className={`rounded-2xl px-4 py-2.5 text-[15px] leading-relaxed whitespace-pre-wrap ${bubbleClass}`}
          >
            {message.content}
          </div>
        </div>
      </div>

      {/* Draft confirmation card */}
      {showDraftCard && readyDraft && draft && draftId && !isUser && (
        <div className="ml-9 max-w-[85%] w-full sm:w-auto">
          {status === "active" ? (
            <div className="rounded-2xl rounded-bl-sm border border-hairline bg-card px-4 py-3 flex items-center justify-between gap-3">
              <div className="text-sm">
                <div className="tabular font-serif text-lg">
                  USD {Number(draft.amount).toFixed(2)}
                </div>
                <div className="text-xs text-muted-foreground capitalize">
                  {draft.type === "income" ? "ingreso" : "gasto"} · {draft.category}
                  {draft.merchant ? ` · ${draft.merchant}` : ""}
                </div>
                <div className="text-xs text-muted-foreground mt-1">Fecha: {draft.date}</div>
              </div>

              <div className="flex gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() => onConfirm(draftId)}
                  disabled={confirming || discarding}
                  className="min-h-[40px] px-3 rounded-full bg-[#7C6FE0] text-white text-sm inline-flex items-center gap-1 hover:opacity-90 disabled:opacity-50"
                  aria-label="Confirmar transacción"
                >
                  <Check className="w-4 h-4" />
                  {confirming ? "Guardando..." : "Confirmar"}
                </button>
                <button
                  type="button"
                  onClick={() => onDiscard(draftId)}
                  disabled={confirming || discarding}
                  className="min-h-[40px] w-10 rounded-full border border-input inline-flex items-center justify-center disabled:opacity-50"
                  aria-label="Descartar transacción"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>
          ) : (
            <div
              className={`rounded-2xl rounded-bl-sm px-4 py-2.5 text-sm inline-flex items-center gap-2 ${
                status === "confirmed"
                  ? "bg-[#7C6FE0]/10 border border-[#7C6FE0]/30 text-foreground"
                  : "bg-muted/60 border border-hairline text-muted-foreground"
              }`}
            >
              <span className="font-medium">
                {draft.type === "income" ? "Ingreso guardado" : "Gasto guardado"}: USD{" "}
                {Number(draft.amount).toFixed(2)} en {draft.category}
                {status === "cancelled" ? " (descartado)" : ""}
              </span>
              {status === "confirmed" ? (
                <Check className="w-4 h-4 text-[#7C6FE0] shrink-0" />
              ) : (
                <X className="w-4 h-4 shrink-0" />
              )}
            </div>
          )}
        </div>
      )}

      {citations && citations.length > 0 && (
        <div className="ml-9 max-w-[85%] text-xs text-muted-foreground flex items-start gap-2">
          <BookOpen className="w-3 h-3 mt-0.5 shrink-0 text-[#7C6FE0]" />
          <span className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
            Fuente:
            {citations.map((citation, index) => (
              <span
                key={`${citation.title}-${citation.version}`}
                className="inline-flex items-center gap-0.5"
              >
                <a
                  href={citation.source}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-0.5 text-[#7C6FE0] hover:underline font-medium"
                >
                  {citation.title} (v{citation.version})
                  <ExternalLink className="w-3 h-3 shrink-0" />
                </a>
                {index < citations.length - 1 ? " ·" : ""}
              </span>
            ))}
          </span>
        </div>
      )}
    </div>
  );
}
