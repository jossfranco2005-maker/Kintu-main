import { describe, expect, it } from "vitest";

import {
  canManageTickets,
  ticketPriorityLabel,
  ticketStatusLabel,
  validateTicketTransition,
} from "@/lib/tickets/ticket-workflow";

describe("ticket human workflow", () => {
  it("solo permite gestionar a agentes y administradores", () => {
    expect(canManageTickets(["user"])).toBe(false);
    expect(canManageTickets(["user", "agent"])).toBe(true);
    expect(canManageTickets(["admin"])).toBe(true);
  });

  it("permite tomar un caso pendiente", () => {
    expect(
      validateTicketTransition({
        currentStatus: "PENDING_HUMAN_REVIEW",
        nextStatus: "IN_REVIEW",
      }),
    ).toEqual({ ok: true });
  });

  it("exige una nota al resolver", () => {
    expect(
      validateTicketTransition({
        currentStatus: "IN_REVIEW",
        nextStatus: "RESOLVED",
        resolutionNote: "   ",
      }),
    ).toEqual({
      ok: false,
      message: "Escribe una nota de resolución antes de cerrar el caso.",
    });
  });

  it("permite resolver con una nota y reabrir", () => {
    expect(
      validateTicketTransition({
        currentStatus: "PENDING_HUMAN_REVIEW",
        nextStatus: "RESOLVED",
        resolutionNote: "Se verificó el movimiento con el cliente.",
      }),
    ).toEqual({ ok: true });

    expect(
      validateTicketTransition({
        currentStatus: "RESOLVED",
        nextStatus: "IN_REVIEW",
      }),
    ).toEqual({ ok: true });
  });

  it("presenta etiquetas legibles", () => {
    expect(ticketStatusLabel("PENDING_HUMAN_REVIEW")).toBe("Pendiente");
    expect(ticketStatusLabel("IN_REVIEW")).toBe("En revisión");
    expect(ticketStatusLabel("RESOLVED")).toBe("Resuelto");
    expect(ticketPriorityLabel("high")).toBe("Alta");
  });
});
