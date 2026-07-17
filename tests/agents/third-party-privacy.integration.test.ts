import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { generateStructuredMock } = vi.hoisted(() => ({ generateStructuredMock: vi.fn() }));
vi.mock("@/lib/ai/structured.server", () => ({ generateStructured: generateStructuredMock }));

import { runOrchestrator } from "@/lib/agents/orchestrator";

function guardedSupabase() {
  const accessedTables: string[] = [];
  const from = vi.fn((table: string) => {
    accessedTables.push(table);
    if (table !== "messages") {
      throw new Error(`La ruta de privacidad no debe consultar ${table}`);
    }
    const builder = {
      select: () => builder,
      eq: () => builder,
      order: () => builder,
      limit: () => builder,
      maybeSingle: async () => ({ data: null, error: null }),
      then(resolve: (value: unknown) => unknown) {
        return Promise.resolve({ data: [], error: null }).then(resolve);
      },
    };
    return builder;
  });
  return { supabase: { from } as unknown as SupabaseClient, accessedTables };
}

function transactionSupabase(): SupabaseClient {
  const from = vi.fn((table: string) => {
    if (table === "messages") {
      const builder = {
        select: () => builder,
        eq: () => builder,
        order: () => builder,
        limit: () => builder,
        maybeSingle: async () => ({ data: null, error: null }),
        then(resolve: (value: unknown) => unknown) {
          return Promise.resolve({ data: [], error: null }).then(resolve);
        },
      };
      return builder;
    }
    if (table === "budgets" || table === "transactions") {
      const builder = {
        select: () => builder,
        eq: () => builder,
        then(resolve: (value: unknown) => unknown) {
          return Promise.resolve({ data: [], error: null }).then(resolve);
        },
      };
      return builder;
    }
    throw new Error(`Tabla inesperada: ${table}`);
  });
  return { from } as unknown as SupabaseClient;
}

const understanding = {
  intent: "support",
  transactionType: null,
  speechAct: "complaint",
  occurred: null,
  negated: false,
  future: false,
  hypothetical: false,
  correction: false,
  multipleOperations: false,
  confidence: 0.92,
  budgetAction: "none",
  dismissPendingState: false,
  currentRequestText: null,
};

describe("third-party privacy at the orchestrator boundary", () => {
  beforeEach(() => generateStructuredMock.mockReset());

  it.each([
    ["Mi hermano está furioso porque gastó demasiado.", "support"],
    ["Carlos está preocupado por sus gastos.", "smalltalk"],
  ])("detiene cualquier recorrido funcional para un tercero: %s", async (text, intent) => {
    generateStructuredMock.mockResolvedValue({ ...understanding, intent });
    const { supabase, accessedTables } = guardedSupabase();

    const result = await runOrchestrator({
      text,
      userId: "user-1",
      conversationId: "conversation-1",
      supabase,
    });

    expect(result.draft).toBeUndefined();
    expect(result.ticket_id).toBeUndefined();
    expect(result.reply).toContain("no puedo revisar sus movimientos desde tu cuenta");
    expect(result.reply).toContain("su propia cuenta");
    expect(accessedTables.every((table) => table === "messages")).toBe(true);
    expect(generateStructuredMock).toHaveBeenCalledTimes(1);
  });

  it("no confunde a un tercero que es únicamente el origen de un ingreso propio", async () => {
    generateStructuredMock
      .mockResolvedValueOnce({
        ...understanding,
        intent: "transaction",
        transactionType: "income",
        speechAct: "report",
        occurred: true,
      })
      .mockResolvedValueOnce({
        type: "income",
        amount: 50,
        currency: "USD",
        date: "2026-07-17",
        category: "otros",
        merchant: "Mi hermano",
        description: null,
      });

    const result = await runOrchestrator({
      text: "Mi hermano me pagó 50 dólares hoy.",
      userId: "user-1",
      conversationId: "conversation-1",
      supabase: transactionSupabase(),
    });

    expect(result.draft).toMatchObject({ type: "income", amount: 50, merchant: "Mi hermano" });
    expect(result.reply).not.toContain("no puedo revisar sus movimientos");
  });
});
