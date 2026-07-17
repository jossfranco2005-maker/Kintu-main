import { beforeEach, describe, expect, it, vi } from "vitest";

const { generateStructuredMock } = vi.hoisted(() => ({
  generateStructuredMock: vi.fn(),
}));

vi.mock("@/lib/ai/structured.server", () => ({
  generateStructured: generateStructuredMock,
}));

import type { SupabaseClient } from "@supabase/supabase-js";
import { buildPersonalizedFinancialReply } from "@/lib/agents/insight-agent.server";

describe("Kintu conversational financial agent", () => {
  const mockFrom = vi.fn();
  const mockSupabase = {
    from: mockFrom,
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    gte: vi.fn().mockReturnThis(),
    lt: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
  } as unknown as SupabaseClient;

  beforeEach(() => {
    generateStructuredMock.mockReset();
    vi.clearAllMocks();
  });

  it("responde coherentemente a preguntas de ingresos y gastos usando los desgloses de datos reales", async () => {
    // Mock the data returned by loadFinancialInsightSnapshot
    const mockTransactions = [
      { type: "income", amount: 850, category: "salario" },
      { type: "income", amount: 240, category: "freelance" },
      { type: "expense", amount: 180, category: "comida" },
    ];
    const mockBudgets = [{ id: "b1", category: "comida", limit_amount: 200, alert_threshold: 0.8 }];

    mockFrom.mockImplementation((table: string) => {
      return {
        select: () => {
          return {
            eq: () => {
              return {
                order: () => Promise.resolve({ data: [], error: null }),
                eq: () => {
                  return {
                    gte: () => {
                      return {
                        lt: () => {
                          if (table === "transactions") {
                            return Promise.resolve({ data: mockTransactions, error: null });
                          }
                          return Promise.resolve({ data: [], error: null });
                        },
                      };
                    },
                    eq: () => {
                      if (table === "budgets") {
                        return Promise.resolve({ data: mockBudgets, error: null });
                      }
                      return Promise.resolve({ data: [], error: null });
                    },
                  };
                },
              };
            },
            order: () => {
              return {
                limit: () => Promise.resolve({ data: [], error: null }),
              };
            },
          };
        },
      };
    });

    generateStructuredMock.mockResolvedValue({
      fact_ids: ["income_category:salario", "income_category:freelance"],
      style: "normal",
      format: "short_paragraph",
      answer:
        "Tu mayor fuente de ingresos es salario con USD 850.00, seguida de freelance con USD 240.00.",
      introduction: null,
      items: [],
      closing: null,
    });

    const reply = await buildPersonalizedFinancialReply({
      supabase: mockSupabase,
      userId: "user-123",
      userText: "¿En qué he tenido más ingresos?",
      conversationId: "conv-456",
    });

    expect(reply).toBe(
      "Tu mayor fuente de ingresos es salario con USD 850.00, seguida de freelance con USD 240.00.",
    );
    expect(generateStructuredMock).toHaveBeenCalledTimes(1);

    // Verify systemPrompt parameters were constructed and sent in prompt config
    const callArgs = generateStructuredMock.mock.calls[0][0];
    expect(callArgs.prompt).toContain("income_category:salario");
    expect(callArgs.prompt).toContain("income_category:freelance");
    expect(callArgs.prompt).toContain("expense_category:comida");
  });

  it("usa una respuesta determinista cuando el LLM no está disponible", async () => {
    generateStructuredMock.mockRejectedValue(new Error("LLM unavailable"));
    const reply = await buildPersonalizedFinancialReply({
      supabase: mockSupabase,
      userId: "user-123",
      userText: "¿Cómo voy este mes?",
      conversationId: "conv-456",
    });
    expect(reply).toContain("USD");
    expect(reply).not.toContain("undefined");
  });
});
