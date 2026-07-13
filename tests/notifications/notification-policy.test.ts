import { describe, expect, it } from "vitest";

import {
  budgetAlertEventKey,
  ticketCreatedEventKey,
  ticketTransitionNotification,
} from "@/lib/notifications/policy";

describe("notification policy", () => {
  it("construye claves idempotentes para alertas y tickets", () => {
    expect(budgetAlertEventKey("alert-123")).toBe("budget:alert:alert-123");
    expect(ticketCreatedEventKey("ticket-123")).toBe("ticket:ticket-123:created");
  });

  it("notifica cuando un agente empieza a revisar un caso", () => {
    expect(
      ticketTransitionNotification({
        nextStatus: "IN_REVIEW",
        summary: "Cargo no reconocido",
      }),
    ).toEqual({
      level: "info",
      title: "Tu caso está en revisión",
      message: "El equipo comenzó a revisar tu caso: Cargo no reconocido",
      event: "in_review",
    });
  });

  it("incluye la resolución humana al cerrar el caso", () => {
    const notification = ticketTransitionNotification({
      nextStatus: "RESOLVED",
      summary: "Transferencia pendiente",
      resolutionNote: "La transferencia fue conciliada y acreditada.",
    });

    expect(notification.title).toBe("Tu caso fue resuelto");
    expect(notification.message).toContain("La transferencia fue conciliada y acreditada.");
    expect(notification.event).toBe("resolved");
  });

  it("advierte cuando el caso vuelve a revisión humana", () => {
    const notification = ticketTransitionNotification({
      nextStatus: "PENDING_HUMAN_REVIEW",
      summary: "Reclamo reabierto",
    });

    expect(notification.level).toBe("warning");
    expect(notification.event).toBe("pending_review");
  });
});
