import { beforeEach, describe, expect, it, vi } from "vitest";

const { generateTextMock } = vi.hoisted(() => ({
  generateTextMock: vi.fn(),
}));

vi.mock("ai", () => ({
  generateText: generateTextMock,
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
    generateTextMock.mockReset();
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

    const mockResponse =
      "Tu categoría con mayores ingresos este mes es Salario con USD 850. Le siguen Freelance con USD 240.";
    generateTextMock.mockResolvedValue({ text: mockResponse });

    const reply = await buildPersonalizedFinancialReply({
      supabase: mockSupabase,
      userId: "user-123",
      userText: "¿En qué he tenido más ingresos?",
      conversationId: "conv-456",
    });

    expect(reply).toBe(mockResponse);
    expect(generateTextMock).toHaveBeenCalledTimes(1);

    // Verify systemPrompt parameters were constructed and sent in prompt config
    const callArgs = generateTextMock.mock.calls[0][0];
    expect(callArgs.system).toContain("Salario");
    expect(callArgs.system).toContain("Freelance");
    expect(callArgs.system).toContain("comida");
  });
});
