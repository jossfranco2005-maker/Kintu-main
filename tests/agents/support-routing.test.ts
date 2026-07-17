import { describe, expect, it } from "vitest";

import { looksLikeSupportRequest } from "@/lib/agents/support-routing";
import { isCompatibleSupportChoice } from "@/lib/agents/support-flow.server";

describe("support intent routing", () => {
  it("detecta una pregunta sobre cambio de correo", () => {
    expect(looksLikeSupportRequest("¿Cómo cambio mi correo?")).toBe(true);
  });

  it("detecta una pregunta sobre horario de atención", () => {
    expect(looksLikeSupportRequest("¿Cuál es el horario de atención?")).toBe(true);
  });

  it("detecta una solicitud explícita de ayuda", () => {
    expect(looksLikeSupportRequest("Necesito ayuda")).toBe(true);
  });

  it("detecta una pregunta sobre un retiro", () => {
    expect(looksLikeSupportRequest("¿Cómo retiro mi dinero?")).toBe(true);
  });

  it("no confunde una conversación casual con soporte", () => {
    expect(looksLikeSupportRequest("¿Cómo estás?")).toBe(false);
  });

  it("no confunde el registro de un gasto con soporte", () => {
    expect(looksLikeSupportRequest("Ayer gasté 10 dólares en comida")).toBe(false);
  });

  it("no confunde la narración de un retiro con una consulta institucional", () => {
    expect(looksLikeSupportRequest("Ayer retiré 50 dólares")).toBe(false);
  });
});

describe("investment education routing", () => {
  it.each([
    "Quiero aprender cómo invertir en bolsa",
    "¿Qué es una acción?",
    "¿Cómo funciona el mercado de valores?",
    "Quiero invertir en la bolsa y no sé cómo hacerlo",
  ])("envía educación financiera a soporte aprobado: %s", (message) => {
    expect(looksLikeSupportRequest(message)).toBe(true);
  });
});

describe("pending support choice compatibility", () => {
  it.each(["1", "abre un caso", "prefiero información general"])(
    "acepta una selección real: %s",
    (text) => expect(isCompatibleSupportChoice(text)).toBe(true),
  );

  it.each([
    "Olvida esa pregunta. ¿Cuánto he gastado en comida este mes?",
    "Ya no quiero abrir un caso. Registra un gasto de 5 dólares en Uber.",
  ])("abandona la elección cuando cambia el tema: %s", (text) => {
    expect(isCompatibleSupportChoice(text)).toBe(false);
  });
});
