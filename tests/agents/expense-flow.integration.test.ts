import { beforeEach, describe, expect, it, vi } from "vitest";

const { generateStructuredMock } = vi.hoisted(() => ({
  generateStructuredMock: vi.fn(),
}));

vi.mock("@/lib/ai/structured.server", () => ({
  generateStructured: generateStructuredMock,
}));

import {
  completeExpenseFlow,
  handleExpenseFlow,
  reviseExpenseFlow,
} from "@/lib/agents/expense-flow";
import type { ExpenseDraft } from "@/lib/agents/schemas";

const incompleteDraft: ExpenseDraft = {
  type: "expense",
  amount: 20,
  currency: "USD",
  date: null,
  category: null,
  merchant: null,
  description: null,
};

describe("expense flow integration", () => {
  beforeEach(() => {
    generateStructuredMock.mockReset();
  });

  it("combina la salida parcial del LLM con evidencia determinista", async () => {
    generateStructuredMock.mockResolvedValue({
      type: "expense",
      amount: 15,
      currency: "USD",
      date: null,
      category: "otros",
      merchant: null,
      description: null,
    });

    const result = await handleExpenseFlow({
      text: "Gasté 15 dólares en mascotas en Veterinaria Luna ayer",
      transactionType: "expense",
    });

    expect(result.draft).toMatchObject({
      amount: 15,
      category: "mascotas",
      merchant: "Veterinaria Luna",
      needs: [],
    });
  });

  it("no acepta categoría ni comercio inventados por el LLM en una respuesta de fecha", async () => {
    generateStructuredMock.mockResolvedValue({
      amount: null,
      date: null,
      category: "otros",
      merchant: "Ayer",
      description: null,
    });

    const result = await completeExpenseFlow({
      text: "Ayer",
      currentDraft: incompleteDraft,
    });

    expect(result.draft?.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(result.draft?.category).toBeNull();
    expect(result.draft?.merchant).toBeNull();
    expect(result.draft?.needs).toEqual(["category", "merchant"]);
  });

  it("recupera el origen de un ingreso omitido por el LLM", async () => {
    generateStructuredMock.mockResolvedValue({
      type: "income",
      amount: 100,
      currency: "USD",
      date: null,
      category: null,
      merchant: null,
      description: null,
    });

    const result = await handleExpenseFlow({
      text: "Me pagaron 100 dólares por un trabajo freelance hoy",
      transactionType: "income",
    });

    expect(result.draft).toMatchObject({
      type: "income",
      category: "otros",
      merchant: "un trabajo freelance",
      needs: [],
    });
  });

  it("usa la corrección determinista sin consultar al LLM", async () => {
    const result = await reviseExpenseFlow({
      text: "No fue comida, fue Mascotas",
      currentDraft: {
        ...incompleteDraft,
        date: "2026-07-12",
        category: "comida",
        merchant: "KFC",
      },
    });

    expect(generateStructuredMock).not.toHaveBeenCalled();
    expect(result.draft).toMatchObject({
      category: "mascotas",
      merchant: "KFC",
    });
  });
});
