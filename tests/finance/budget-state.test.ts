import { describe, expect, it } from "vitest";

import { budgetState, evaluateBudget, type BudgetRow } from "@/lib/finance/budget";

const budget: BudgetRow = {
  id: "budget-1",
  category: "comida",
  month: "2026-07-01",
  limit_amount: 200,
  alert_threshold: 0.8,
};

describe("budget state", () => {
  it("mantiene estado normal antes del umbral", () => {
    expect(budgetState({ spent: 159.99, limitAmount: 200, alertThreshold: 0.8 })).toBe("normal");
  });

  it("marca advertencia desde el umbral configurado", () => {
    expect(budgetState({ spent: 160, limitAmount: 200, alertThreshold: 0.8 })).toBe("warning");
  });

  it("marca excedido al alcanzar o superar el límite", () => {
    expect(budgetState({ spent: 200, limitAmount: 200, alertThreshold: 0.8 })).toBe("exceeded");
  });

  it("expone porcentaje, restante y exceso con números deterministas", () => {
    const status = evaluateBudget(budget, 230, 190);

    expect(status.state).toBe("exceeded");
    expect(status.percentage).toBe(1.15);
    expect(status.remaining).toBe(0);
    expect(status.overage).toBe(30);
    expect(status.exceeded).toBe(true);
  });
});
