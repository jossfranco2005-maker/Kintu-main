import { describe, expect, it } from "vitest";

import { getMissingExpenseFields } from "@/lib/agents/expense-draft";
import type { ExpenseDraft } from "@/lib/agents/schemas";
import { resolveTransactionFields } from "@/lib/agents/transaction-field-resolver";

const baseDraft: ExpenseDraft = {
  type: "expense",
  amount: 20,
  currency: "USD",
  date: null,
  category: null,
  merchant: null,
  description: null,
};

describe("typed transaction field resolver", () => {
  it("extrae un gasto completo sin depender de campos del LLM", () => {
    const result = resolveTransactionFields({
      text: "Gasté 20 dólares en comida en KFC ayer",
      type: "expense",
      llmPatch: {
        amount: null,
        date: null,
        category: null,
        merchant: null,
        description: null,
      },
    });

    expect(result).toMatchObject({
      amount: 20,
      category: "comida",
      merchant: "KFC",
    });
    expect(result.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("completa un borrador por turnos sin mezclar fecha, categoría y comercio", () => {
    const withDate = resolveTransactionFields({
      text: "Ayer",
      type: "expense",
      currentDraft: baseDraft,
      missingFields: getMissingExpenseFields(baseDraft),
      llmPatch: { category: "otros", merchant: "Ayer" },
    });
    expect(withDate.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(withDate.category).toBeNull();
    expect(withDate.merchant).toBeNull();

    const withCategory = resolveTransactionFields({
      text: "Mascotas",
      type: "expense",
      currentDraft: withDate,
      missingFields: getMissingExpenseFields(withDate),
      llmPatch: { category: "otros", merchant: "Mascotas" },
    });
    expect(withCategory.category).toBe("mascotas");
    expect(withCategory.merchant).toBeNull();

    const complete = resolveTransactionFields({
      text: "Veterinaria Luna",
      type: "expense",
      currentDraft: withCategory,
      missingFields: getMissingExpenseFields(withCategory),
      llmPatch: { merchant: null },
    });
    expect(complete.merchant).toBe("Veterinaria Luna");
    expect(getMissingExpenseFields(complete)).toEqual([]);
  });

  it.each([
    ["Ayer", "Ayer"],
    ["Comida", "Comida"],
    ["20 dólares", "20 dólares"],
  ])("nunca usa %s como comercio", (text, llmMerchant) => {
    const draft: ExpenseDraft = {
      ...baseDraft,
      date: "2026-07-12",
      category: "transporte",
    };
    const result = resolveTransactionFields({
      text,
      type: "expense",
      currentDraft: draft,
      missingFields: ["merchant"],
      llmPatch: { merchant: llmMerchant },
    });

    expect(result.merchant).toBeNull();
  });

  it("extrae fecha y comercio de una misma respuesta", () => {
    const draft: ExpenseDraft = {
      ...baseDraft,
      category: "comida",
    };
    const result = resolveTransactionFields({
      text: "Ayer en KFC",
      type: "expense",
      currentDraft: draft,
      missingFields: ["date", "merchant"],
      llmPatch: { date: null, merchant: null },
    });

    expect(result.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(result.merchant).toBe("KFC");
  });

  it("acepta una categoría nueva en un mensaje completo sin convertirla en otros", () => {
    const result = resolveTransactionFields({
      text: "Gasté 15 dólares en mascotas en Veterinaria Luna ayer",
      type: "expense",
      llmPatch: { category: "otros", merchant: null },
    });

    expect(result.category).toBe("mascotas");
    expect(result.merchant).toBe("Veterinaria Luna");
  });

  it("recupera el origen de un ingreso aunque el LLM lo deje en null", () => {
    const result = resolveTransactionFields({
      text: "Me pagaron 100 dólares por un trabajo freelance hoy",
      type: "income",
      llmPatch: { merchant: null, category: null },
    });

    expect(result).toMatchObject({
      amount: 100,
      category: "otros",
      merchant: "un trabajo freelance",
    });
  });

  it("conserva los campos existentes cuando el LLM devuelve null", () => {
    const complete: ExpenseDraft = {
      ...baseDraft,
      date: "2026-07-10",
      category: "mascotas",
      merchant: "Veterinaria Luna",
      description: "Vacuna anual",
    };
    const result = resolveTransactionFields({
      text: "ok",
      type: "expense",
      currentDraft: complete,
      missingFields: [],
      llmPatch: {
        amount: null,
        date: null,
        category: null,
        merchant: null,
        description: null,
      },
    });

    expect(result).toEqual(complete);
  });

  it("separa el comercio de la descripción", () => {
    const result = resolveTransactionFields({
      text: "Ayer gasté 18 dólares en comida en KFC por un almuerzo con un cliente",
      type: "expense",
      llmPatch: { merchant: "KFC por un almuerzo con un cliente", description: null },
    });

    expect(result.merchant).toBe("KFC");
    expect(result.description).toBe("un almuerzo con un cliente");
  });

  it("limpia una fecha incluida por el LLM dentro del comercio", () => {
    const draft: ExpenseDraft = {
      ...baseDraft,
      category: "comida",
    };
    const result = resolveTransactionFields({
      text: "Ayer en KFC",
      type: "expense",
      currentDraft: draft,
      missingFields: ["date", "merchant"],
      llmPatch: { merchant: "Ayer en KFC" },
    });

    expect(result.merchant).toBe("KFC");
  });

  it("extrae una descripción opcional sin exigirla", () => {
    const result = resolveTransactionFields({
      text: "Ayer gasté 18 dólares en comida en KFC por un almuerzo con un cliente",
      type: "expense",
      llmPatch: { description: null },
    });

    expect(result.description).toBe("un almuerzo con un cliente");
  });

  it("no confunde una fecha ISO con un monto", () => {
    const result = resolveTransactionFields({
      text: "2026-07-12",
      type: "expense",
      currentDraft: { ...baseDraft, amount: null },
      missingFields: ["amount", "date", "category", "merchant"],
    });

    expect(result.amount).toBeNull();
    expect(result.date).toBe("2026-07-12");
  });
});
