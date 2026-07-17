import { beforeEach, describe, expect, it, vi } from "vitest";

const { generateStructuredMock } = vi.hoisted(() => ({ generateStructuredMock: vi.fn() }));
vi.mock("@/lib/ai/structured.server", () => ({ generateStructured: generateStructuredMock }));

import { understandMessage } from "@/lib/agents/message-understanding.server";

const base = {
  transactionType: null,
  speechAct: "question",
  occurred: null,
  negated: false,
  future: false,
  hypothetical: false,
  correction: false,
  multipleOperations: false,
  confidence: 0.95,
  budgetAction: "none",
  dismissPendingState: false,
  currentRequestText: null,
};

describe("contextual message understanding", () => {
  beforeEach(() => generateStructuredMock.mockReset());

  it.each([
    "Estoy frustrado porque no entendí mi presupuesto.",
    "¿Me explicas lo que significa el límite de comida?",
  ])("distingue una consulta presupuestaria: %s", async (text) => {
    generateStructuredMock.mockResolvedValue({ ...base, intent: "budget", budgetAction: "query" });
    await expect(understandMessage(text)).resolves.toMatchObject({
      intent: "budget",
      budgetAction: "query",
    });
  });

  it.each(["Crea un presupuesto de 200 para comida.", "Ajusta el límite de transporte a 250."])(
    "distingue una mutación presupuestaria: %s",
    async (text) => {
      generateStructuredMock.mockResolvedValue({
        ...base,
        intent: "budget",
        speechAct: "command",
        budgetAction: "create_or_update",
      });
      await expect(understandMessage(text)).resolves.toMatchObject({
        budgetAction: "create_or_update",
      });
    },
  );

  it("representa la instrucción vigente de un mensaje compuesto", async () => {
    generateStructuredMock.mockResolvedValue({
      ...base,
      intent: "transaction",
      transactionType: "expense",
      speechAct: "report",
      occurred: true,
      dismissPendingState: true,
      currentRequestText: "Registra un gasto de 5 dólares en Uber.",
    });
    await expect(
      understandMessage("No quiero ninguna opción. Registra un gasto de 5 dólares en Uber."),
    ).resolves.toMatchObject({
      intent: "transaction",
      dismissPendingState: true,
      currentRequestText: "Registra un gasto de 5 dólares en Uber.",
    });
  });

  it("rechaza una solicitud vigente inventada por el modelo", async () => {
    generateStructuredMock.mockResolvedValue({
      ...base,
      intent: "transaction",
      transactionType: "expense",
      speechAct: "report",
      occurred: true,
      dismissPendingState: true,
      currentRequestText: "Registra un gasto de 500 dólares.",
    });
    await expect(
      understandMessage("Olvida lo anterior y dime cuánto gasté en comida."),
    ).resolves.toMatchObject({ dismissPendingState: false, currentRequestText: null });
  });

  it("usa el historial para una continuación de estilo", async () => {
    generateStructuredMock.mockResolvedValue({ ...base, intent: "summary" });
    const history = [{ role: "assistant", content: "Comida fue tu gasto principal." }];
    await understandMessage("¿Cómo llegaste a esa conclusión?", history);
    expect(generateStructuredMock.mock.calls[0][0].prompt).toContain(
      "Comida fue tu gasto principal",
    );
  });

  it("mantiene ambigua una frase nominal sin temporalidad", async () => {
    generateStructuredMock.mockResolvedValue({
      ...base,
      intent: "transaction",
      transactionType: "expense",
      speechAct: "unknown",
      occurred: false,
      confidence: 0.45,
    });
    const result = await understandMessage("Compra de 20 dólares el 20 de julio.");
    expect(result).toMatchObject({ intent: "transaction", occurred: false });
  });

  it.each([
    "La empresa donde trabajo me depositó 800 dólares de sueldo.",
    "Me consignaron 300 por una venta.",
  ])("usa evidencia fuerte de ingreso cuando el modelo devuelve unknown: %s", async (text) => {
    generateStructuredMock.mockResolvedValue({
      ...base,
      intent: "unknown",
      speechAct: "unknown",
      confidence: 0.4,
    });
    await expect(understandMessage(text)).resolves.toMatchObject({
      intent: "transaction",
      transactionType: "income",
      occurred: true,
      source: "rules",
    });
  });
});
