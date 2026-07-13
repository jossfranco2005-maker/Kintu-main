import { describe, expect, it } from "vitest";

import {
  firstTransactionWelcome,
  getMissingExpenseFields,
  questionForMissingField,
} from "@/lib/agents/expense-draft";
import type { ExpenseDraft } from "@/lib/agents/schemas";

const completeDraft: ExpenseDraft = {
  type: "expense",
  amount: 45,
  currency: "USD",
  date: "2026-07-10",
  category: "comida",
  merchant: "KFC",
  description: null,
};

describe("expense draft validation", () => {
  it("no reporta faltantes cuando el borrador está completo", () => {
    expect(getMissingExpenseFields(completeDraft)).toEqual([]);
  });

  it("reporta todos los campos obligatorios faltantes en orden", () => {
    expect(
      getMissingExpenseFields({
        ...completeDraft,
        amount: null,
        date: null,
        category: null,
        merchant: null,
      }),
    ).toEqual(["amount", "date", "category", "merchant"]);
  });

  it("pregunta únicamente por el siguiente dato faltante", () => {
    expect(questionForMissingField("merchant", "expense")).toBe(
      "¿Dónde o a quién realizaste el pago?",
    );
  });

  it("da una bienvenida útil solo para el primer borrador incompleto", () => {
    const reply = firstTransactionWelcome(
      { ...completeDraft, merchant: null, needs: ["merchant"] },
      questionForMissingField("merchant", "expense"),
    );

    expect(reply).toContain("¡Hola! Soy Kintu");
    expect(reply).toContain("¿Dónde o a quién realizaste el pago?");
    expect(reply).not.toContain("comercio");
  });

  it("does not require a category for income", () => {
    expect(
      getMissingExpenseFields({
        ...completeDraft,
        type: "income",
        category: null,
        merchant: "Trabajo freelance",
      }),
    ).toEqual([]);
  });
});

describe("natural category questions", () => {
  it("lista categorías fijas y personalizadas y permite una nueva", () => {
    const reply = questionForMissingField("category", "expense", new Set(["mascotas", "viajes"]));

    expect(reply).toContain("Comida");
    expect(reply).toContain("Mascotas");
    expect(reply).toContain("Viajes");
    expect(reply).toContain("escribir una nueva");
  });
});
