import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { generateStructuredMock } = vi.hoisted(() => ({ generateStructuredMock: vi.fn() }));
vi.mock("@/lib/ai/structured.server", () => ({ generateStructured: generateStructuredMock }));

import { handleSupportFlow } from "@/lib/agents/support-flow.server";

function ticketSupabase() {
  const ticketInsert = vi.fn();
  const from = vi.fn((table: string) => {
    if (table === "messages") {
      const builder = {
        select: () => builder,
        eq: () => builder,
        order: () => builder,
        limit: async () => ({ data: [], error: null }),
      };
      return builder;
    }
    if (table === "tickets") {
      const builder = {
        select: () => builder,
        eq: () => builder,
        order: () => builder,
        limit: () => builder,
        maybeSingle: async () => ({ data: null, error: null }),
        insert: (value: unknown) => {
          ticketInsert(value);
          return {
            select: () => ({
              single: async () => ({ data: { id: "ticket-12345678" }, error: null }),
            }),
          };
        },
      };
      return builder;
    }
    throw new Error(`Tabla inesperada: ${table}`);
  });
  return { supabase: { from } as unknown as SupabaseClient, ticketInsert, from };
}

describe("support situation understanding", () => {
  beforeEach(() => generateStructuredMock.mockReset());

  it.each(["Estoy enojado.", "Esto me tiene muy frustrado."])(
    "responde con empatía sin crear ticket: %s",
    async (text) => {
      generateStructuredMock.mockResolvedValue({
        state: "emotion_only",
        category: null,
        priority: null,
        subject: "current_user",
        reason: "Emoción sin incidente",
      });
      const from = vi.fn(() => {
        throw new Error("No debe consultar persistencia");
      });
      const result = await handleSupportFlow({
        text,
        userId: "user-1",
        conversationId: "conversation-1",
        supabase: { from } as unknown as SupabaseClient,
      });
      expect(result.ticket_id).toBeUndefined();
      expect(result.reply).toContain("¿Qué ocurrió?");
      expect(from).not.toHaveBeenCalled();
    },
  );

  it.each([
    "Estoy enojado porque no reconozco un cargo.",
    "Me cobraron dos veces y estoy furioso.",
    "Estoy enojado y quiero hablar con una persona.",
  ])("crea ticket cuando existe incidente o solicitud humana: %s", async (text) => {
    const { supabase, ticketInsert } = ticketSupabase();
    const result = await handleSupportFlow({
      text,
      userId: "user-1",
      conversationId: "conversation-1",
      supabase,
    });
    expect(result.ticket_id).toBe("ticket-12345678");
    expect(ticketInsert).toHaveBeenCalledTimes(1);
    expect(result.reply).toContain("revisión humana");
  });

  it.each([
    "Mi hermana está preocupada por sus gastos.",
    "Un amigo está furioso por su cuenta.",
    "Mi pareja no entiende su presupuesto.",
    "Un compañero de trabajo está molesto.",
  ])("protege la privacidad financiera de un tercero: %s", async (text) => {
    generateStructuredMock.mockResolvedValue({
      state: "emotion_only",
      category: null,
      priority: null,
      subject: "third_party",
      reason: "La situación corresponde a otra persona",
    });
    const from = vi.fn(() => {
      throw new Error("No debe consultar datos ni persistencia");
    });
    const result = await handleSupportFlow({
      text,
      userId: "user-1",
      conversationId: "conversation-1",
      supabase: { from } as unknown as SupabaseClient,
    });
    expect(result.ticket_id).toBeUndefined();
    expect(result.reply).toContain("no puedo revisar sus movimientos desde tu cuenta");
    expect(result.reply).toContain("su propia cuenta");
    expect(from).not.toHaveBeenCalled();
  });
});
