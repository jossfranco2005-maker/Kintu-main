import { describe, expect, it } from "vitest";

import {
  collectAffectedBudgetBuckets,
  previousSpentFromCurrent,
  type BudgetBucket,
  type MovementChange,
  type MovementSnapshot,
} from "@/lib/finance/movement-effects";

function expense(overrides: Partial<MovementSnapshot> = {}): MovementSnapshot {
  return {
    type: "expense",
    amount: 25,
    date: "2026-07-12",
    category: "comida",
    status: "confirmed",
    ...overrides,
  };
}

const foodJuly: BudgetBucket = { category: "comida", month: "2026-07-01" };

describe("movement budget effects", () => {
  it("reconstruye el gasto previo de una creación confirmada", () => {
    const changes: MovementChange[] = [{ before: null, after: expense({ amount: 30 }) }];

    expect(previousSpentFromCurrent(90, changes, foodJuly)).toBe(60);
  });

  it("ignora movimientos pendientes e ingresos", () => {
    const changes: MovementChange[] = [
      { before: null, after: expense({ status: "pending", amount: 80 }) },
      { before: null, after: expense({ type: "income", amount: 100 }) },
    ];

    expect(collectAffectedBudgetBuckets(changes)).toEqual([]);
    expect(previousSpentFromCurrent(40, changes, foodJuly)).toBe(40);
  });

  it("reconstruye el gasto previo de una eliminación", () => {
    const changes: MovementChange[] = [{ before: expense({ amount: 20 }), after: null }];

    expect(previousSpentFromCurrent(50, changes, foodJuly)).toBe(70);
  });

  it("maneja una edición de monto en la misma categoría", () => {
    const changes: MovementChange[] = [
      {
        before: expense({ amount: 20 }),
        after: expense({ amount: 45 }),
      },
    ];

    expect(previousSpentFromCurrent(95, changes, foodJuly)).toBe(70);
  });

  it("identifica tanto la categoría anterior como la nueva al recategorizar", () => {
    const changes: MovementChange[] = [
      {
        before: expense({ category: "comida", amount: 30 }),
        after: expense({ category: "transporte", amount: 30 }),
      },
    ];

    expect(collectAffectedBudgetBuckets(changes)).toEqual([
      { category: "comida", month: "2026-07-01" },
      { category: "transporte", month: "2026-07-01" },
    ]);
  });

  it("reconstruye el total anterior de una importación por lote", () => {
    const changes: MovementChange[] = [
      { before: null, after: expense({ amount: 10 }) },
      { before: null, after: expense({ amount: 15 }) },
      {
        before: null,
        after: expense({ amount: 50, category: "transporte" }),
      },
    ];

    expect(previousSpentFromCurrent(100, changes, foodJuly)).toBe(75);
  });
});
