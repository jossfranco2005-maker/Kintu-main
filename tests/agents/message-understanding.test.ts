import { describe, expect, it } from "vitest";

import {
  analyzeMessageWithRules,
  decideUnderstandingAction,
  detectsMultipleOperations,
  isDraftCorrectionMessage,
  isExplicitCancellationMessage,
  isExplicitConfirmationMessage,
  hasExplicitBudgetMutationAction,
} from "@/lib/agents/message-understanding";

function analyze(text: string) {
  const result = analyzeMessageWithRules(text);
  expect(result).not.toBeNull();
  return result!;
}

describe("message understanding rules", () => {
  it.each([
    "Gané 100 dólares",
    "Me pagaron por una chambita",
    "Me cayó una platita de 80",
    "Me entraron 50",
    "Vendí algo por 40",
  ])("detecta un ingreso ocurrido: %s", (text) => {
    expect(analyze(text)).toMatchObject({
      intent: "transaction",
      transactionType: "income",
      occurred: true,
      negated: false,
    });
  });

  it.each([
    "Gasté 20 en comida",
    "Pagué 12 por el taxi",
    "Se me fueron 30 en el mercado",
    "Me cobraron 18 en KFC",
  ])("detecta un gasto ocurrido: %s", (text) => {
    expect(analyze(text)).toMatchObject({
      intent: "transaction",
      transactionType: "expense",
      occurred: true,
    });
  });

  it("bloquea una transacción negada", () => {
    const result = analyze("No gasté 20 dólares");
    expect(result).toMatchObject({ negated: true, occurred: false });
    expect(decideUnderstandingAction(result)).toBe("ignore_negated");
  });

  it("bloquea una transacción futura", () => {
    const result = analyze("Mañana me pagan 100 dólares");
    expect(result).toMatchObject({ future: true, occurred: false });
    expect(decideUnderstandingAction(result)).toBe("ignore_future");
  });

  it("bloquea una transacción hipotética", () => {
    const result = analyze("Ojalá ganara 100 dólares");
    expect(result).toMatchObject({ hypothetical: true, occurred: false });
    expect(decideUnderstandingAction(result)).toBe("ignore_hypothetical");
  });

  it("trata una condición como hipotética", () => {
    const result = analyze("Si gano 100 dólares, los ahorro");
    expect(result).toMatchObject({ hypothetical: true, occurred: false });
  });

  it("detecta varias operaciones", () => {
    const result = analyze("Gasté 10 en taxi y 25 en comida");
    expect(result.multipleOperations).toBe(true);
    expect(decideUnderstandingAction(result)).toBe("split_multiple");
  });

  it("no confunde una fecha y un monto con varias operaciones", () => {
    expect(detectsMultipleOperations("Gasté 20 el 12/07/2026 en comida")).toBe(false);
  });

  it.each([
    "Me cobraron dos veces",
    "No me llegó la transferencia",
    "Me debitaron de más",
    "Esa compra no fue mía",
  ])("prioriza soporte para un reclamo: %s", (text) => {
    expect(analyze(text)).toMatchObject({
      intent: "support",
      speechAct: "complaint",
    });
  });

  it("clasifica una pregunta de uso como soporte", () => {
    expect(analyze("¿Cómo registro un ingreso?")).toMatchObject({
      intent: "support",
      speechAct: "question",
      occurred: false,
    });
  });

  it("detecta una corrección", () => {
    expect(isDraftCorrectionMessage("No fueron 30, fueron 20")).toBe(true);
    expect(analyze("No fueron 30, fueron 20")).toMatchObject({
      intent: "correction",
      correction: true,
    });
  });

  it("detecta cancelación explícita", () => {
    expect(isExplicitCancellationMessage("no, cancélalo")).toBe(true);
    expect(decideUnderstandingAction(analyze("cancelar"))).toBe("cancel");
  });

  it.each([
    "olvídalo, cancela ese gasto",
    "ya no quiero registrar eso",
    "descarta la transacción anterior",
  ])("detecta una cancelación natural compuesta: %s", (text) =>
    expect(isExplicitCancellationMessage(text)).toBe(true),
  );

  it.each(["sí, confirma", "confirma otra vez"])("detecta confirmación explícita: %s", (text) =>
    expect(isExplicitConfirmationMessage(text)).toBe(true),
  );

  it.each([
    "Analiza mis gastos",
    "¿Qué patrón ves en mis finanzas?",
    "¿En qué gasto más?",
    "Dame un insight",
  ])("clasifica una solicitud de insight como resumen: %s", (text) => {
    expect(analyze(text)).toMatchObject({ intent: "summary" });
  });

  it("deja la charla general fuera de transacciones", () => {
    expect(analyze("Hola")).toMatchObject({ intent: "smalltalk" });
  });

  it.each(["El sueldo suele pagarse cada fin de mes.", "¿Qué significa sueldo neto?"])(
    "no convierte una mención general de sueldo en transacción: %s",
    (text) => expect(analyzeMessageWithRules(text)).toBeNull(),
  );

  it.each(["Crea un presupuesto de 200", "Ajusta el límite de comida"])(
    "valida una acción explícita de presupuesto: %s",
    (text) => expect(hasExplicitBudgetMutationAction(text)).toBe(true),
  );

  it.each(["No entiendo mi presupuesto", "Explícame el límite de comida"])(
    "no confunde una consulta con mutación: %s",
    (text) => expect(hasExplicitBudgetMutationAction(text)).toBe(false),
  );
});
