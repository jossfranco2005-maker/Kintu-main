import { describe, expect, it } from "vitest";

import {
  applyExpenseCorrection,
  extractDeterministicExpenseCorrection,
} from "@/lib/agents/expense-correction";
import type { ExpenseDraft } from "@/lib/agents/schemas";
import { shiftIsoDate, todayInEcuador } from "@/lib/finance/date";

const baseDraft: ExpenseDraft = {
  type: "expense",
  amount: 30,
  currency: "USD",
  date: "2026-07-11",
  category: "comida",
  merchant: "KFC",
  description: null,
};

describe("expense draft corrections", () => {
  it("usa el último monto como valor corregido", () => {
    expect(extractDeterministicExpenseCorrection("No fueron 30, fueron 20").amount).toBe(20);
  });

  it("extrae el comercio corregido", () => {
    expect(extractDeterministicExpenseCorrection("No fue KFC, fue Burger King").merchant).toBe(
      "Burger King",
    );
  });

  it("extrae la categoría corregida", () => {
    expect(extractDeterministicExpenseCorrection("No fue comida, fue transporte").category).toBe(
      "transporte",
    );
  });

  it("usa la segunda fecha de una corrección", () => {
    expect(extractDeterministicExpenseCorrection("No fue ayer, fue hoy").date).toMatch(
      /^\d{4}-\d{2}-\d{2}$/,
    );
  });

  it("permite cambiar gasto por ingreso", () => {
    expect(extractDeterministicExpenseCorrection("No era gasto, era ingreso").type).toBe("income");
  });

  it("aplica solo los campos corregidos", () => {
    const corrected = applyExpenseCorrection(baseDraft, {
      type: null,
      amount: 20,
      date: null,
      category: null,
      merchant: "Burger King",
      description: null,
    });

    expect(corrected).toEqual({
      ...baseDraft,
      amount: 20,
      merchant: "Burger King",
    });
  });

  it("delimita la categoría cuando la misma oración corrige otros campos", () => {
    const today = todayInEcuador();
    const draft: ExpenseDraft = {
      type: "expense",
      amount: 9,
      currency: "USD",
      date: shiftIsoDate(today, -1),
      category: "comida",
      merchant: "una cafetería",
      description: null,
    };
    const patch = extractDeterministicExpenseCorrection(
      "Cambia el monto a 8 dólares, la categoría a entretenimiento y la fecha a hoy.",
      { currentDraft: draft },
    );
    const corrected = applyExpenseCorrection(draft, patch);

    expect(corrected.amount).toBe(8);
    expect(corrected.category).toBe("entretenimiento");
    expect(corrected.date).toBe(today);
    expect(corrected.merchant).toBe("una cafetería");
    expect(corrected.type).toBe("expense");
    expect(corrected.description).toBeNull();
    expect(corrected.currency).toBe("USD");
  });
});

describe("field-specific corrections", () => {
  it("corrige una categoría personalizada sin convertirla en comercio", () => {
    const patch = extractDeterministicExpenseCorrection("No fue comida, fue Mascotas", {
      currentDraft: baseDraft,
      userCategories: new Set(),
    });

    expect(patch.category).toBe("mascotas");
    expect(patch.merchant).toBeNull();
  });

  it("corrige solo la descripción", () => {
    const patch = extractDeterministicExpenseCorrection(
      "Cambia la descripción a almuerzo de trabajo",
      { currentDraft: baseDraft },
    );
    const corrected = applyExpenseCorrection(baseDraft, patch);

    expect(corrected).toEqual({
      ...baseDraft,
      description: "almuerzo de trabajo",
    });
  });

  it("no confunde un comercio relacionado con salud con una categoría", () => {
    const patch = extractDeterministicExpenseCorrection("No fue KFC, fue Farmacia Cruz Azul", {
      currentDraft: baseDraft,
    });
    const corrected = applyExpenseCorrection(baseDraft, patch);

    expect(corrected.merchant).toBe("Farmacia Cruz Azul");
    expect(corrected.category).toBe("comida");
  });

  it("corrige el comercio sin modificar la categoría", () => {
    const patch = extractDeterministicExpenseCorrection("No fue KFC, fue Supermaxi", {
      currentDraft: baseDraft,
    });
    const corrected = applyExpenseCorrection(baseDraft, patch);

    expect(corrected.merchant).toBe("Supermaxi");
    expect(corrected.category).toBe("comida");
  });
});
