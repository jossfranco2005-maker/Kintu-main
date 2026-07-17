import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { generateStructuredMock } = vi.hoisted(() => ({ generateStructuredMock: vi.fn() }));
vi.mock("@/lib/ai/structured.server", () => ({ generateStructured: generateStructuredMock }));

import { runOrchestrator } from "@/lib/agents/orchestrator";

const understandingBase = {
  speechAct: "report",
  occurred: true,
  negated: false,
  future: false,
  hypothetical: false,
  correction: false,
  multipleOperations: false,
  confidence: 0.95,
  budgetAction: "none",
  dismissPendingState: false,
  currentRequestText: null,
};

function conversationSupabase() {
  const history = [
    {
      role: "user",
      content: "La empresa donde trabajo me depositó 800 dólares de sueldo.",
      created_at: "2026-07-17T10:00:00Z",
    },
    {
      role: "assistant",
      content:
        "No estoy completamente seguro de lo que deseas hacer. ¿Quieres registrar un ingreso, un gasto, crear un presupuesto o pedir ayuda?",
      created_at: "2026-07-17T10:00:01Z",
    },
    { role: "user", content: "Es un ingreso.", created_at: "2026-07-17T10:00:02Z" },
  ];

  const from = vi.fn((table: string) => {
    if (table === "messages") {
      let selection = "";
      const builder = {
        select(value: string) {
          selection = value;
          return builder;
        },
        eq: () => builder,
        order: () => builder,
        limit: () => builder,
        maybeSingle: async () => ({ data: null, error: null }),
        then(resolve: (value: unknown) => unknown) {
          return Promise.resolve(
            selection.includes("role, content")
              ? { data: history, error: null }
              : { data: null, error: null },
          ).then(resolve);
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

describe("orchestrator contextual clarification recovery", () => {
  beforeEach(() => generateStructuredMock.mockReset());

  it("recupera monto, categoría y origen del mensaje inmediatamente anterior", async () => {
    generateStructuredMock
      .mockResolvedValueOnce({
        ...understandingBase,
        intent: "transaction",
        transactionType: "income",
      })
      .mockResolvedValueOnce({
        ...understandingBase,
        intent: "transaction",
        transactionType: "income",
      })
      .mockResolvedValueOnce({
        type: "income",
        amount: 800,
        currency: "USD",
        date: null,
        category: "sueldo",
        merchant: "La empresa donde trabajo",
        description: null,
      });

    const result = await runOrchestrator({
      text: "Es un ingreso.",
      userId: "user-1",
      conversationId: "conversation-1",
      supabase: conversationSupabase(),
    });

    expect(result.draft).toMatchObject({
      type: "income",
      amount: 800,
      category: "sueldo",
      merchant: "La empresa donde trabajo",
      needs: ["date"],
    });
    expect(result.reply).toContain("USD 800.00");
    expect(result.reply).toContain("Me falta la fecha");
    expect(generateStructuredMock.mock.calls[2][0].prompt).toContain(
      "La empresa donde trabajo me depositó 800 dólares de sueldo.",
    );
  });
});
