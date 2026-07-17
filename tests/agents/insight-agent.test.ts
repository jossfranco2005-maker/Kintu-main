import { describe, expect, it } from "vitest";

import {
  buildVerifiedFinancialFacts,
  validateFinancialResponsePlan,
  selectValidInsightCandidates,
} from "@/lib/agents/insight-agent.server";
import type { FinancialInsightCandidate } from "@/lib/finance/insights";

const candidates: FinancialInsightCandidate[] = [
  {
    id: "budget_exceeded:food",
    kind: "budget_exceeded",
    priority: 100,
    title: "Presupuesto excedido",
    message: "Mensaje 1",
  },
  {
    id: "expense_growth:general",
    kind: "expense_growth",
    priority: 80,
    title: "Gastos aumentaron",
    message: "Mensaje 2",
  },
  {
    id: "positive_balance:general",
    kind: "positive_balance",
    priority: 55,
    title: "Balance positivo",
    message: "Mensaje 3",
  },
];

describe("insight agent selection", () => {
  it("acepta únicamente identificadores existentes y sin duplicados", () => {
    expect(
      selectValidInsightCandidates(candidates, [
        "expense_growth:general",
        "desconocido",
        "expense_growth:general",
        "positive_balance:general",
      ]).map((item) => item.id),
    ).toEqual(["expense_growth:general", "positive_balance:general"]);
  });

  it("usa la prioridad determinista cuando el modelo no selecciona nada válido", () => {
    expect(
      selectValidInsightCandidates(candidates, ["inexistente"]).map((item) => item.id),
    ).toEqual(["budget_exceeded:food", "expense_growth:general"]);
  });
});

describe("verified financial facts", () => {
  it("calcula saldos y porcentajes de presupuesto en código", () => {
    const facts = buildVerifiedFinancialFacts({
      month: "2026-07-01",
      current: {
        income: 1000,
        expense: 250,
        net: 750,
        transactionCount: 3,
        byCategory: { comida: 200, transporte: 50 },
        expenseByCategory: { comida: 200, transporte: 50 },
        incomeByCategory: { sueldo: 1000 },
      },
      previous: { income: 0, expense: 0, net: 0, transactionCount: 0, byCategory: {} },
      budgets: [{ id: "b1", category: "comida", limitAmount: 300, alertThreshold: 0.8 }],
    });

    const budget = facts.find((fact) => fact.id === "budget:comida")?.text;
    expect(budget).toContain("USD 200.00 de USD 300.00 (67%)");
    expect(budget).toContain("Te faltan USD 100.00");
  });
});

describe("validated adaptive financial presentation", () => {
  const facts = [
    { id: "total_income", text: "Ingresos del mes: USD 1000.00." },
    { id: "total_expense", text: "Gastos del mes: USD 250.00." },
    { id: "net", text: "Balance neto del mes: USD 750.00." },
    {
      id: "budget:comida",
      text: "Presupuesto de comida: llevas USD 320.00 de USD 300.00 (107%). Excedes el límite por USD 20.00.",
      critical: true,
    },
  ];

  it("valida un desglose exhaustivo de cinco categorías cuya suma coincide con el total", () => {
    const categoryFacts = [
      { id: "total_expense", text: "Gastos del mes: USD 683.00." },
      { id: "expense_category:comida", text: "Gasto en comida: USD 370.00." },
      { id: "expense_category:servicios", text: "Gasto en servicios: USD 120.00." },
      { id: "expense_category:otros", text: "Gasto en otros: USD 90.00." },
      { id: "expense_category:transporte", text: "Gasto en transporte: USD 59.00." },
      {
        id: "expense_category:entretenimiento",
        text: "Gasto en entretenimiento: USD 44.00.",
      },
    ];
    const result = validateFinancialResponsePlan({
      availableFacts: categoryFacts,
      plan: {
        fact_ids: categoryFacts.slice(1).map((fact) => fact.id),
        coverage: "exhaustive",
        style: "normal",
        format: "bullet_list",
        answer: null,
        introduction: "Desglose completo:",
        items: categoryFacts.slice(1).map((fact) => fact.text),
        closing: null,
      },
    });
    expect(result?.selected).toHaveLength(5);
    expect(result?.text).toContain("entretenimiento");
    expect(result?.text).toContain("USD 44.00");
  });

  it("rechaza un desglose exhaustivo que omite una categoría", () => {
    const categoryFacts = [
      { id: "total_expense", text: "Gastos del mes: USD 683.00." },
      { id: "expense_category:comida", text: "Gasto en comida: USD 639.00." },
      { id: "expense_category:entretenimiento", text: "Gasto en entretenimiento: USD 44.00." },
    ];
    expect(
      validateFinancialResponsePlan({
        availableFacts: categoryFacts,
        plan: {
          fact_ids: ["expense_category:comida"],
          coverage: "exhaustive",
          style: "normal",
          format: "sentence",
          answer: "Gasto en comida: USD 639.00.",
          introduction: null,
          items: [],
          closing: null,
        },
      }),
    ).toBeNull();
  });

  it("permite exactamente tres categorías en un resumen top tres", () => {
    const categoryFacts = ["comida", "servicios", "transporte", "entretenimiento"].map(
      (category, index) => ({
        id: `expense_category:${category}`,
        text: `Gasto en ${category}: USD ${400 - index * 50}.00.`,
      }),
    );
    const result = validateFinancialResponsePlan({
      availableFacts: categoryFacts,
      plan: {
        fact_ids: categoryFacts.slice(0, 3).map((fact) => fact.id),
        coverage: "summary",
        style: "normal",
        format: "bullet_list",
        answer: null,
        introduction: "Tus tres categorías principales:",
        items: categoryFacts.slice(0, 3).map((fact) => fact.text),
        closing: null,
      },
    });
    expect(result?.selected).toHaveLength(3);
  });

  it("renderiza un resumen legible con viñetas de texto plano", () => {
    const result = validateFinancialResponsePlan({
      availableFacts: facts,
      plan: {
        fact_ids: ["total_income", "total_expense", "net"],
        coverage: "summary",
        style: "normal",
        format: "summary_with_bullets",
        answer: null,
        introduction: "Este es tu resumen del mes:",
        items: ["Ingresos: USD 1000.00", "Gastos: USD 250.00", "Balance: USD 750.00"],
        closing: null,
      },
    });
    expect(result?.text).toContain("\n- Ingresos: USD 1000.00");
  });

  it("mantiene una respuesta concreta como oración", () => {
    const result = validateFinancialResponsePlan({
      availableFacts: facts,
      plan: {
        fact_ids: ["net"],
        coverage: "single",
        style: "brief",
        format: "sentence",
        answer: "Tu balance neto es USD 750.00.",
        introduction: null,
        items: [],
        closing: null,
      },
    });
    expect(result?.text).toBe("Tu balance neto es USD 750.00.");
    expect(result?.text).not.toContain("-");
  });

  it("acepta una transformación de formato numérico estrictamente equivalente", () => {
    const result = validateFinancialResponsePlan({
      availableFacts: facts,
      plan: {
        fact_ids: ["total_income"],
        coverage: "single",
        style: "brief",
        format: "sentence",
        answer: "Tus ingresos son USD 1.000,00.",
        introduction: null,
        items: [],
        closing: null,
      },
    });
    expect(result?.text).toContain("USD 1.000,00");
  });

  it("rechaza una cifra que no pertenece a los hechos seleccionados", () => {
    expect(
      validateFinancialResponsePlan({
        availableFacts: facts,
        plan: {
          fact_ids: ["net"],
          coverage: "single",
          style: "normal",
          format: "sentence",
          answer: "Tu balance es USD 999.00.",
          introduction: null,
          items: [],
          closing: null,
        },
      }),
    ).toBeNull();
  });

  it("rechaza identificadores inexistentes", () => {
    expect(
      validateFinancialResponsePlan({
        availableFacts: facts,
        plan: {
          fact_ids: ["inventado"],
          coverage: "single",
          style: "normal",
          format: "sentence",
          answer: "No hay datos.",
          introduction: null,
          items: [],
          closing: null,
        },
      }),
    ).toBeNull();
  });

  it("no permite ocultar las cifras de una advertencia crítica seleccionada", () => {
    expect(
      validateFinancialResponsePlan({
        availableFacts: facts,
        plan: {
          fact_ids: ["budget:comida"],
          coverage: "single",
          style: "brief",
          format: "sentence",
          answer: "Tu presupuesto de comida requiere atención.",
          introduction: null,
          items: [],
          closing: null,
        },
      }),
    ).toBeNull();
  });
});
