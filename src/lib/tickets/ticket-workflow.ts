export const TICKET_STATUSES = ["PENDING_HUMAN_REVIEW", "IN_REVIEW", "RESOLVED"] as const;

export type TicketStatus = (typeof TICKET_STATUSES)[number];
export type AppRole = "user" | "agent" | "admin";

export function canManageTickets(roles: readonly string[]): boolean {
  return roles.includes("agent") || roles.includes("admin");
}

export function ticketStatusLabel(status: TicketStatus): string {
  switch (status) {
    case "PENDING_HUMAN_REVIEW":
      return "Pendiente";
    case "IN_REVIEW":
      return "En revisión";
    case "RESOLVED":
      return "Resuelto";
  }
}

export function ticketPriorityLabel(priority: string): string {
  switch (priority.toLowerCase()) {
    case "high":
      return "Alta";
    case "low":
      return "Baja";
    default:
      return "Media";
  }
}

const ALLOWED_TRANSITIONS: Record<TicketStatus, readonly TicketStatus[]> = {
  PENDING_HUMAN_REVIEW: ["IN_REVIEW", "RESOLVED"],
  IN_REVIEW: ["PENDING_HUMAN_REVIEW", "RESOLVED"],
  RESOLVED: ["IN_REVIEW"],
};

export function validateTicketTransition(params: {
  currentStatus: TicketStatus;
  nextStatus: TicketStatus;
  resolutionNote?: string | null;
}): { ok: true } | { ok: false; message: string } {
  const { currentStatus, nextStatus } = params;

  if (currentStatus === nextStatus) {
    return {
      ok: false,
      message: "El caso ya se encuentra en ese estado.",
    };
  }

  if (!ALLOWED_TRANSITIONS[currentStatus].includes(nextStatus)) {
    return {
      ok: false,
      message: `No se permite cambiar de ${ticketStatusLabel(currentStatus)} a ${ticketStatusLabel(nextStatus)}.`,
    };
  }

  if (nextStatus === "RESOLVED" && !params.resolutionNote?.trim()) {
    return {
      ok: false,
      message: "Escribe una nota de resolución antes de cerrar el caso.",
    };
  }

  return { ok: true };
}
