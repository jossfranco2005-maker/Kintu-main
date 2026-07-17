import { useMemo, useState, useEffect } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CheckCircle2,
  ChevronDown,
  Clock,
  LifeBuoy,
  RotateCcw,
  ShieldCheck,
  UserCheck,
} from "lucide-react";
import { toast } from "sonner";

import { listTickets, updateTicketStatus } from "@/lib/tickets.functions";
import {
  ticketPriorityLabel,
  ticketStatusLabel,
  type TicketStatus,
} from "@/lib/tickets/ticket-workflow";

type TicketsSearch = {
  ticketId?: string;
};

export const Route = createFileRoute("/_authenticated/tickets")({
  component: TicketsPage,
  validateSearch: (search: Record<string, unknown>): TicketsSearch => {
    return {
      ticketId: typeof search.ticketId === "string" ? search.ticketId : undefined,
    };
  },
});

type ConversationEntry = {
  role?: string;
  content?: string;
  created_at?: string;
};

type TicketRow = {
  id: string;
  user_id: string;
  category: string;
  priority: string;
  summary: string;
  context_json: Record<string, unknown> | null;
  conversation_json: unknown;
  status: TicketStatus;
  assigned_to: string | null;
  resolution_note: string | null;
  created_at: string;
  updated_at: string;
  resolved_at: string | null;
};

function parseConversation(value: unknown): ConversationEntry[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((entry): entry is ConversationEntry => {
    return Boolean(entry && typeof entry === "object");
  });
}

function statusClasses(status: TicketStatus): string {
  switch (status) {
    case "PENDING_HUMAN_REVIEW":
      return "bg-gold/20 text-ink";
    case "IN_REVIEW":
      return "bg-clay/15 text-clay";
    case "RESOLVED":
      return "bg-[#7C6FE0]/15 text-[#4C3A8C] dark:text-[#B9A9F5]";
  }
}

function priorityClasses(priority: string): string {
  switch (priority.toLowerCase()) {
    case "high":
      return "border-destructive/30 bg-destructive/10 text-destructive";
    case "low":
      return "border-[#7C6FE0]/30 bg-[#7C6FE0]/10 text-[#4C3A8C] dark:text-[#B9A9F5]";
    default:
      return "border-gold/30 bg-gold/10 text-ink";
  }
}

function TicketsPage() {
  const queryClient = useQueryClient();
  const list = useServerFn(listTickets);
  const updateStatus = useServerFn(updateTicketStatus);
  const [filter, setFilter] = useState<"open" | "resolved" | "all">("open");
  const [notes, setNotes] = useState<Record<string, string>>({});
  const { ticketId } = Route.useSearch();

  const query = useQuery({
    queryKey: ["tickets"],
    queryFn: () => list(),
  });

  const mutation = useMutation({
    mutationFn: (variables: {
      ticketId: string;
      status: TicketStatus;
      resolutionNote?: string | null;
    }) => updateStatus({ data: variables }),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["tickets"] });
      setNotes((current) => ({ ...current, [variables.ticketId]: "" }));

      const message =
        variables.status === "IN_REVIEW"
          ? "Caso tomado para revisión."
          : variables.status === "RESOLVED"
            ? "Caso resuelto con trazabilidad."
            : "Caso devuelto a pendiente.";

      toast.success(message);
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "No se pudo actualizar el caso.");
    },
  });

  const canManage = Boolean(query.data?.canManage);

  const visibleTickets = useMemo(() => {
    const tickets = (query.data?.tickets || []) as TicketRow[];

    if (!canManage || filter === "all") {
      return tickets;
    }

    if (filter === "resolved") {
      return tickets.filter((ticket) => ticket.status === "RESOLVED");
    }

    return tickets.filter((ticket) => ticket.status !== "RESOLVED");
  }, [canManage, filter, query.data?.tickets]);

  // Auto-adjust filter if ticketId is specified and is resolved
  useEffect(() => {
    if (ticketId && query.data?.tickets) {
      const target = (query.data.tickets as TicketRow[]).find((t) => t.id === ticketId);
      if (target) {
        if (target.status === "RESOLVED") {
          setFilter("resolved");
        } else {
          setFilter("open");
        }
      }
    }
  }, [ticketId, query.data?.tickets]);

  // Scroll to ticket
  useEffect(() => {
    if (ticketId && visibleTickets.length > 0) {
      const element = document.getElementById(`ticket-${ticketId}`);
      if (element) {
        const timer = setTimeout(() => {
          element.scrollIntoView({ behavior: "smooth", block: "center" });
        }, 100);
        return () => clearTimeout(timer);
      }
    }
  }, [ticketId, visibleTickets]);

  return (
    <div className="mx-auto max-w-4xl w-full px-4 py-8 space-y-6">
      {/* Header */}
      <div className="border-b border-[#E4E0F5] dark:border-hairline pb-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="font-serif text-3xl text-[#4C3A8C] dark:text-[#B9A9F5] font-semibold">
            {canManage ? (
              <>
                Bandeja de revisión <span className="highlight">humana</span>
              </>
            ) : (
              <>
                Casos con <span className="highlight">humanos</span>
              </>
            )}
          </h1>
          <p className="text-xs text-muted-foreground mt-1.5 leading-relaxed">
            {canManage
              ? "Revisa el contexto que reunió Kintu, toma el caso y deja una resolución trazable."
              : "Toda solicitud sensible se gestiona aquí y es revisada directamente por un asesor calificado."}
          </p>
        </div>

        {canManage && (
          <div className="flex gap-2" aria-label="Filtrar casos">
            {(["open", "resolved", "all"] as const).map((value) => (
              <button
                key={value}
                type="button"
                onClick={() => setFilter(value)}
                className={`min-h-[40px] rounded-md border px-3 text-sm ${
                  filter === value ? "bg-[#4C3A8C] text-white" : "bg-card hover:bg-accent"
                }`}
              >
                {value === "open" ? "Abiertos" : value === "resolved" ? "Resueltos" : "Todos"}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Loading / error states */}
      {query.isLoading && (
        <div className="rounded-lg border bg-card p-6 text-sm text-muted-foreground">
          Cargando casos…
        </div>
      )}

      {query.isError && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
          {query.error instanceof Error ? query.error.message : "No se pudieron cargar los casos."}
        </div>
      )}

      {/* Empty state */}
      {!query.isLoading && visibleTickets.length === 0 && (
        <div className="notebook-card p-10 text-center flex flex-col items-center justify-center">
          <LifeBuoy className="w-10 h-10 text-[#7C6FE0]/60 mb-3" />
          <p className="text-sm font-semibold text-foreground">
            {canManage && filter === "resolved"
              ? "Todavía no hay casos resueltos."
              : "Ningún caso abierto"}
          </p>
          <p className="text-xs text-muted-foreground mt-1">Todo está en orden y bajo control.</p>
        </div>
      )}

      {/* Ticket list */}
      <div className="space-y-4">
        {visibleTickets.map((ticket) => {
          const conversation = parseConversation(ticket.conversation_json);
          const isUpdating = mutation.isPending && mutation.variables?.ticketId === ticket.id;
          const note = notes[ticket.id] ?? "";
          const context = ticket.context_json || {};
          const trigger =
            typeof context.trigger === "object" && context.trigger
              ? (context.trigger as Record<string, unknown>)
              : null;

          return (
            <article
              id={`ticket-${ticket.id}`}
              key={ticket.id}
              className={`rounded-xl border bg-card p-4 shadow-sm space-y-4 transition-all duration-500 ${
                ticketId === ticket.id
                  ? "border-[#7C6FE0] ring-2 ring-[#7C6FE0]/20 shadow-md scale-[1.01]"
                  : ""
              }`}
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className={`rounded-md border px-2 py-1 text-xs font-medium ${priorityClasses(ticket.priority)}`}
                    >
                      Prioridad {ticketPriorityLabel(ticket.priority)}
                    </span>
                    <span
                      className={`rounded-full px-2 py-1 text-xs ${statusClasses(ticket.status)}`}
                    >
                      {ticketStatusLabel(ticket.status)}
                    </span>
                  </div>
                  <p className="text-sm font-medium text-foreground">{ticket.summary}</p>
                </div>

                <p className="text-xs text-muted-foreground flex items-center gap-1 tabular">
                  <Clock className="w-3 h-3" /> #{ticket.id.slice(0, 8)} ·{" "}
                  {new Date(ticket.created_at).toLocaleString("es-EC")}
                </p>
              </div>

              <div className="grid gap-3 sm:grid-cols-3 text-xs">
                <div className="rounded-md bg-muted/50 p-3">
                  <p className="text-muted-foreground">Categoría</p>
                  <p className="mt-1 font-medium capitalize">{ticket.category}</p>
                </div>
                <div className="rounded-md bg-muted/50 p-3">
                  <p className="text-muted-foreground">Acción automática</p>
                  <p className="mt-1 font-medium">
                    {context.automation_executed === true ? "Ejecutada" : "No ejecutada"}
                  </p>
                </div>
                <div className="rounded-md bg-muted/50 p-3">
                  <p className="text-muted-foreground">Responsable</p>
                  <p className="mt-1 font-medium">
                    {ticket.assigned_to
                      ? `Agente ${ticket.assigned_to.slice(0, 8)}`
                      : "Sin asignar"}
                  </p>
                </div>
              </div>

              {ticket.resolution_note && (
                <div className="rounded-md border border-[#7C6FE0]/25 bg-[#7C6FE0]/10 p-3">
                  <p className="text-xs font-medium text-[#4C3A8C] dark:text-[#B9A9F5] flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4" /> Resolución humana
                  </p>
                  <p className="mt-2 text-sm">{ticket.resolution_note}</p>
                  {ticket.resolved_at && (
                    <p className="mt-2 text-xs text-muted-foreground">
                      Resuelto el {new Date(ticket.resolved_at).toLocaleString("es-EC")}
                    </p>
                  )}
                </div>
              )}

              <details
                open={ticketId === ticket.id}
                className="group rounded-md border bg-background/60 p-3"
              >
                <summary className="flex cursor-pointer list-none items-center justify-between text-sm font-medium">
                  Ver contexto e historial
                  <ChevronDown className="h-4 w-4 transition-transform group-open:rotate-180" />
                </summary>

                <div className="mt-4 space-y-4">
                  <div>
                    <p className="text-xs uppercase tracking-wide text-muted-foreground">
                      Contexto detectado
                    </p>
                    <dl className="mt-2 grid gap-2 text-sm sm:grid-cols-2">
                      <div>
                        <dt className="text-muted-foreground">Canal</dt>
                        <dd>{String(context.channel || "web")}</dd>
                      </div>
                      <div>
                        <dt className="text-muted-foreground">Motivo</dt>
                        <dd>{String(trigger?.reason || "Revisión humana requerida")}</dd>
                      </div>
                    </dl>
                  </div>

                  <div>
                    <p className="text-xs uppercase tracking-wide text-muted-foreground">
                      Historial reciente ({conversation.length})
                    </p>
                    {conversation.length === 0 ? (
                      <p className="mt-2 text-sm text-muted-foreground">No se adjuntó historial.</p>
                    ) : (
                      <div className="mt-2 space-y-2">
                        {conversation.map((entry, index) => (
                          <div
                            key={`${ticket.id}-${index}`}
                            className="rounded-md bg-muted/50 p-3 text-sm"
                          >
                            <p className="text-xs font-medium uppercase text-muted-foreground">
                              {entry.role === "assistant"
                                ? "Kintu"
                                : entry.role === "user"
                                  ? "Cliente"
                                  : entry.role}
                            </p>
                            <p className="mt-1 whitespace-pre-wrap">
                              {entry.content || "Sin contenido"}
                            </p>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </details>

              {canManage && (
                <div className="rounded-lg border border-clay/20 bg-clay/5 p-3 space-y-3">
                  <p className="text-xs font-medium uppercase tracking-wide text-clay flex items-center gap-2">
                    <ShieldCheck className="h-4 w-4" /> Gestión humana
                  </p>

                  {ticket.status !== "RESOLVED" && (
                    <textarea
                      value={note}
                      onChange={(event) =>
                        setNotes((current) => ({ ...current, [ticket.id]: event.target.value }))
                      }
                      placeholder="Escribe la resolución aplicada o la orientación dada al cliente…"
                      maxLength={1200}
                      className="min-h-[90px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                    />
                  )}

                  <div className="flex flex-wrap gap-2">
                    {ticket.status === "PENDING_HUMAN_REVIEW" && (
                      <button
                        type="button"
                        disabled={isUpdating}
                        onClick={() =>
                          mutation.mutate({ ticketId: ticket.id, status: "IN_REVIEW" })
                        }
                        className="min-h-[42px] rounded-md border bg-background px-3 text-sm font-medium hover:bg-accent disabled:opacity-50"
                      >
                        <span className="inline-flex items-center gap-2">
                          <UserCheck className="h-4 w-4" /> Tomar caso
                        </span>
                      </button>
                    )}

                    {ticket.status !== "RESOLVED" && (
                      <button
                        type="button"
                        disabled={isUpdating || !note.trim()}
                        onClick={() =>
                          mutation.mutate({
                            ticketId: ticket.id,
                            status: "RESOLVED",
                            resolutionNote: note,
                          })
                        }
                        className="min-h-[42px] rounded-md bg-[#4C3A8C] px-3 text-sm font-medium text-white disabled:opacity-50"
                      >
                        <span className="inline-flex items-center gap-2">
                          <CheckCircle2 className="h-4 w-4" /> Resolver caso
                        </span>
                      </button>
                    )}

                    {ticket.status === "IN_REVIEW" && (
                      <button
                        type="button"
                        disabled={isUpdating}
                        onClick={() =>
                          mutation.mutate({ ticketId: ticket.id, status: "PENDING_HUMAN_REVIEW" })
                        }
                        className="min-h-[42px] rounded-md border bg-background px-3 text-sm hover:bg-accent disabled:opacity-50"
                      >
                        Devolver a pendiente
                      </button>
                    )}

                    {ticket.status === "RESOLVED" && (
                      <button
                        type="button"
                        disabled={isUpdating}
                        onClick={() =>
                          mutation.mutate({ ticketId: ticket.id, status: "IN_REVIEW" })
                        }
                        className="min-h-[42px] rounded-md border bg-background px-3 text-sm hover:bg-accent disabled:opacity-50"
                      >
                        <span className="inline-flex items-center gap-2">
                          <RotateCcw className="h-4 w-4" /> Reabrir caso
                        </span>
                      </button>
                    )}
                  </div>
                </div>
              )}
            </article>
          );
        })}
      </div>
    </div>
  );
}
