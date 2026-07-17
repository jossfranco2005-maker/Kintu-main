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

  it.each([
    [
      "El 6 de julio recibí 90 dólares por un trabajo freelance de Andrea.",
      { amount: 90, date: "2026-07-06", category: "freelance", merchant: "Andrea", needs: [] },
    ],
    [
      "Hoy recibí 1000 dólares de sueldo de Empresa Demo.",
      {
        amount: 1000,
        date: "2026-07-17",
        category: "sueldo",
        merchant: "Empresa Demo",
        needs: [],
      },
    ],
    [
      "Me pagaron 75 dólares por un diseño para Juan.",
      { amount: 75, date: null, category: "diseño", merchant: "Juan", needs: ["date"] },
    ],
  ])("transporta todos los campos del ingreso por el flujo real: %s", async (text, expected) => {
    generateStructuredMock.mockResolvedValue({
      type: "income",
      amount: expected.amount,
      currency: "USD",
      date: expected.date,
      category: expected.category,
      merchant: expected.merchant,
      description: null,
    });

    const result = await handleExpenseFlow({
      text,
      transactionType: "income",
      today: "2026-07-17",
    });
    expect(result.draft).toMatchObject({ type: "income", ...expected });
  });

  it("conserva una categoría de ingreso respaldada en una formulación natural", async () => {
    generateStructuredMock.mockResolvedValue({
      type: "income",
      amount: 95,
      currency: "USD",
      date: "2026-07-17",
      category: "diseño",
      merchant: "Andrea",
      description: "diseño de logo",
    });
    const result = await handleExpenseFlow({
      text: "Andrea me pagó 95 dólares por diseñarle un logo hoy.",
      transactionType: "income",
      today: "2026-07-17",
    });
    expect(result.draft).toMatchObject({
      type: "income",
      amount: 95,
      category: "diseño",
      merchant: "Andrea",
      date: "2026-07-17",
      needs: [],
    });
  });

  it("usa otros cuando un ingreso no contiene evidencia de categoría", async () => {
    generateStructuredMock.mockResolvedValue({
      type: "income",
      amount: 50,
      currency: "USD",
      date: "2026-07-17",
      category: null,
      merchant: null,
      description: null,
    });
    const result = await handleExpenseFlow({
      text: "Recibí 50 dólares.",
      transactionType: "income",
      today: "2026-07-17",
    });
    expect(result.draft).toMatchObject({ type: "income", amount: 50, category: "otros" });
  });

  it("conserva evidencia explícita de categoría y origen aunque el modelo omita esos campos", async () => {
    generateStructuredMock.mockResolvedValue({
      type: "income",
      amount: 90,
      currency: "USD",
      date: "2026-07-06",
      category: null,
      merchant: null,
      description: null,
    });
    const result = await handleExpenseFlow({
      text: "El 6 de julio recibí 90 dólares por un trabajo freelance de Andrea.",
      transactionType: "income",
      today: "2026-07-17",
    });
    expect(result.draft).toMatchObject({
      type: "income",
      amount: 90,
      date: "2026-07-06",
      category: "freelance",
      merchant: "Andrea",
    });
  });

  it("mantiene el borrador y pide aclarar una fecha futura contradictoria", async () => {
    generateStructuredMock.mockResolvedValue({
      type: "expense",
      amount: 200,
      currency: "USD",
      date: "2026-07-20",
      category: "otros",
      merchant: "vendedor del carro",
      description: "carro",
    });
    const result = await handleExpenseFlow({
      text: "Me compré un carro, costó 200 dólares el 20 de julio.",
      transactionType: "expense",
      today: "2026-07-17",
    });
    expect(result.draft).toMatchObject({ amount: 200, date: null, merchant: "vendedor del carro" });
    expect(result.reply).toContain("20 de julio de 2026 todavía no ha ocurrido");
    expect(result.reply).toContain("20 de julio de 2025");
  });

  it("completa solo la fecha cuando el usuario confirma el año sugerido", async () => {
    generateStructuredMock.mockResolvedValue({
      amount: null,
      date: "2025-07-20",
      category: null,
      merchant: null,
      description: null,
    });
    const result = await completeExpenseFlow({
      text: "Sí, fue en 2025.",
      currentDraft: {
        type: "expense",
        amount: 200,
        currency: "USD",
        date: null,
        category: "otros",
        merchant: "vendedor del carro",
        description: "carro",
      },
      history: [
        { role: "user", content: "Me compré un carro el 20 de julio." },
        {
          role: "assistant",
          content: "¿Te refieres al 20 de julio de 2025?",
        },
      ],
    });
    expect(result.draft).toMatchObject({
      amount: 200,
      date: "2025-07-20",
      category: "otros",
      merchant: "vendedor del carro",
      needs: [],
    });
    expect(result.reply).toContain("20 de julio de 2025");
    expect(result.reply).not.toContain("2025-07-20");
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
