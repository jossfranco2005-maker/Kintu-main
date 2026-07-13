import { describe, expect, it } from "vitest";

import { selectValidInsightCandidates } from "@/lib/agents/insight-agent.server";
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
