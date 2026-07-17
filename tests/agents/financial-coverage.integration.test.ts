import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { generateStructuredMock } = vi.hoisted(() => ({ generateStructuredMock: vi.fn() }));
vi.mock("@/lib/ai/structured.server", () => ({ generateStructured: generateStructuredMock }));

import { buildPersonalizedFinancialReply } from "@/lib/agents/insight-agent.server";

const expenses = [
  { type: "expense", amount: 370, category: "comida" },
  { type: "expense", amount: 120, category: "servicios" },
  { type: "expense", amount: 90, category: "otros" },
  { type: "expense", amount: 59, category: "transporte" },
  { type: "expense", amount: 44, category: "entretenimiento" },
];

function financialSupabase(): SupabaseClient {
  let transactionQuery = 0;
  const from = vi.fn((table: string) => {
    const builder = {
      select: () => builder,
      eq: () => builder,
      gte: () => builder,
      lt: async () => ({
        data: transactionQuery++ === 0 ? expenses : [],
        error: null,
      }),
      then(resolve: (value: unknown) => unknown) {
        return Promise.resolve({ data: [], error: null }).then(resolve);
      },
    };
    if (table !== "transactions" && table !== "budgets") {
      throw new Error(`Tabla inesperada: ${table}`);
    }
    return builder;
  });
  return { from } as unknown as SupabaseClient;
}

const categoryIds = expenses.map((row) => `expense_category:${row.category}`);
const categoryItems = expenses.map(
  (row, index) =>
    `${index === 0 ? "La categoría de mayor gasto" : "Gasto"} en ${row.category}: USD ${row.amount.toFixed(2)}.`,
);

describe("financial response coverage", () => {
  beforeEach(() => generateStructuredMock.mockReset());

  it("mantiene una consulta de egresos en una sola frase y un solo hecho", async () => {
    generateStructuredMock.mockResolvedValue({
      fact_ids: ["total_expense"],
      coverage: "single",
      style: "brief",
      format: "sentence",
      answer: "Tus egresos de este mes suman USD 683.00.",
      introduction: null,
      items: [],
      closing: null,
    });
    const reply = await buildPersonalizedFinancialReply({
      supabase: financialSupabase(),
      userId: "user-1",
      userText: "¿En cuánto van mis egresos este mes?",
    });
    expect(reply).toBe("Tus egresos de este mes suman USD 683.00.");
    expect(reply).not.toContain("\n-");
  });

  it("incluye las cinco categorías en un desglose exhaustivo", async () => {
    generateStructuredMock.mockResolvedValue({
      fact_ids: categoryIds,
      coverage: "exhaustive",
      style: "normal",
      format: "bullet_list",
      answer: null,
      introduction: "Tus gastos se distribuyen así:",
      items: categoryItems,
      closing: null,
    });
    const reply = await buildPersonalizedFinancialReply({
      supabase: financialSupabase(),
      userId: "user-1",
      userText: "Desglósame esos gastos por categoría.",
    });
    for (const row of expenses) {
      expect(reply).toContain(row.category);
      expect(reply).toContain(`USD ${row.amount.toFixed(2)}`);
    }
    expect(expenses.reduce((sum, row) => sum + row.amount, 0)).toBe(683);
  });

  it("usa el desglose determinista completo si el plan exhaustivo omite una categoría", async () => {
    generateStructuredMock.mockResolvedValue({
      fact_ids: categoryIds.slice(0, 4),
      coverage: "exhaustive",
      style: "normal",
      format: "bullet_list",
      answer: null,
      introduction: "Desglose:",
      items: categoryItems.slice(0, 4),
      closing: null,
    });
    const reply = await buildPersonalizedFinancialReply({
      supabase: financialSupabase(),
      userId: "user-1",
      userText: "Muéstrame la distribución completa.",
    });
    expect(reply).toContain("entretenimiento");
    expect(reply).toContain("USD 44.00");
  });

  it("conserva exactamente tres hechos para un top tres", async () => {
    generateStructuredMock.mockResolvedValue({
      fact_ids: categoryIds.slice(0, 3),
      coverage: "summary",
      style: "normal",
      format: "bullet_list",
      answer: null,
      introduction: "Tus tres categorías principales:",
      items: categoryItems.slice(0, 3),
      closing: null,
    });
    const reply = await buildPersonalizedFinancialReply({
      supabase: financialSupabase(),
      userId: "user-1",
      userText: "¿Cuáles son mis tres categorías principales?",
    });
    expect((reply.match(/\n- /g) ?? []).length).toBe(3);
    expect(reply).not.toContain("transporte");
    expect(reply).not.toContain("entretenimiento");
  });
});
