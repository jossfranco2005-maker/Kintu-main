import { describe, expect, it } from "vitest";

import {
  buildDeterministicFinancialSummary,
  buildFinancialInsightCandidates,
  summarizeInsightTransactions,
  type FinancialInsightSnapshot,
} from "@/lib/finance/insights";

function snapshot(overrides: Partial<FinancialInsightSnapshot> = {}): FinancialInsightSnapshot {
  return {
    month: "2026-07-01",
    current: {
      income: 1000,
      expense: 500,
      net: 500,
      transactionCount: 4,
      byCategory: { comida: 300, transporte: 200 },
    },
    previous: {
      income: 900,
      expense: 400,
      net: 500,
      transactionCount: 3,
      byCategory: { comida: 250, transporte: 150 },
    },
    budgets: [],
    ...overrides,
  };
}

describe("financial insights", () => {
  it("resume transacciones válidas por tipo y categoría", () => {
    expect(
      summarizeInsightTransactions([
        { type: "income", amount: 100, category: "otros" },
        { type: "expense", amount: 30, category: "comida" },
        { type: "expense", amount: 20, category: "comida" },
        { type: "expense", amount: Number.NaN, category: "otros" },
      ]),
    ).toEqual({
      income: 100,
      expense: 50,
      net: 50,
      transactionCount: 4,
      byCategory: { comida: 50 },
      incomeByCategory: { otros: 100 },
      expenseByCategory: { comida: 50 },
    });
  });

  it("prioriza un presupuesto excedido", () => {
    const result = buildFinancialInsightCandidates(
      snapshot({
        budgets: [
          {
            id: "budget-food",
            category: "comida",
            limitAmount: 200,
            alertThreshold: 0.8,
          },
        ],
      }),
    );

    expect(result[0]).toMatchObject({ kind: "budget_exceeded", priority: 100 });
    expect(result[0].message).toContain("USD 100.00");
  });

  it("detecta un presupuesto en advertencia", () => {
    const result = buildFinancialInsightCandidates(
      snapshot({
        current: {
          income: 500,
          expense: 85,
          net: 415,
          transactionCount: 2,
          byCategory: { transporte: 85 },
        },
        budgets: [
          {
            id: "budget-transport",
            category: "transporte",
            limitAmount: 100,
            alertThreshold: 0.8,
          },
        ],
      }),
    );

    expect(result.some((item) => item.kind === "budget_warning")).toBe(true);
  });

  it("detecta un balance negativo", () => {
    const result = buildFinancialInsightCandidates(
      snapshot({
        current: {
          income: 100,
          expense: 180,
          net: -80,
          transactionCount: 3,
          byCategory: { comida: 180 },
        },
      }),
    );

    expect(result.some((item) => item.kind === "negative_balance")).toBe(true);
  });

  it("compara gastos con el mes anterior", () => {
    const result = buildFinancialInsightCandidates(snapshot());

    expect(result.some((item) => item.kind === "expense_growth")).toBe(true);
  });

  it("identifica una categoría dominante y sin presupuesto", () => {
    const result = buildFinancialInsightCandidates(snapshot());

    expect(result.some((item) => item.kind === "top_category")).toBe(true);
    expect(result.some((item) => item.kind === "missing_budget")).toBe(true);
  });

  it("responde con seguridad cuando no hay datos", () => {
    const empty = snapshot({
      current: {
        income: 0,
        expense: 0,
        net: 0,
        transactionCount: 0,
        byCategory: {},
      },
    });
    const candidates = buildFinancialInsightCandidates(empty);

    expect(candidates).toHaveLength(1);
    expect(candidates[0].kind).toBe("no_data");
    expect(buildDeterministicFinancialSummary(empty, candidates)).toContain(
      "no tengo movimientos confirmados",
    );
  });

  it("construye un resumen usando únicamente hechos calculados", () => {
    const value = snapshot();
    const candidates = buildFinancialInsightCandidates(value).slice(0, 2);
    const reply = buildDeterministicFinancialSummary(
      value,
      candidates,
      "Sigue revisando tus hábitos con calma.",
    );

    expect(reply).toContain("ingresos por USD 1000.00");
    expect(reply).toContain("gastos por USD 500.00");
    expect(reply).toContain("Sigue revisando tus hábitos con calma.");
  });
});
