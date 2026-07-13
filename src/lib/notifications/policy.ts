import type { TicketStatus } from "@/lib/tickets/ticket-workflow";

export type NotificationLevel = "info" | "warning" | "urgent";

export type TicketTransitionNotification = {
  level: NotificationLevel;
  title: string;
  message: string;
  event: "in_review" | "resolved" | "pending_review";
};

export function ticketTransitionNotification(params: {
  nextStatus: TicketStatus;
  summary: string;
  resolutionNote?: string | null;
}): TicketTransitionNotification {
  const summary = params.summary.trim();

  switch (params.nextStatus) {
    case "IN_REVIEW":
      return {
        level: "info",
        title: "Tu caso está en revisión",
        message: `El equipo comenzó a revisar tu caso: ${summary}`,
        event: "in_review",
      };
    case "RESOLVED": {
      const resolution = params.resolutionNote?.trim();
      return {
        level: "info",
        title: "Tu caso fue resuelto",
        message: resolution
          ? `Resolución del equipo: ${resolution}`
          : `El equipo marcó como resuelto tu caso: ${summary}`,
        event: "resolved",
      };
    }
    case "PENDING_HUMAN_REVIEW":
      return {
        level: "warning",
        title: "Tu caso volvió a revisión",
        message: `El caso volvió a la bandeja de revisión humana: ${summary}`,
        event: "pending_review",
      };
  }
}

export function budgetAlertEventKey(alertId: string): string {
  return `budget:alert:${alertId}`;
}

export function ticketCreatedEventKey(ticketId: string): string {
  return `ticket:${ticketId}:created`;
}
