import { describe, expect, it } from "vitest";

import {
  classifySensitivity,
  requestsPersonalizedInvestmentAdvice,
} from "@/lib/finance/sensitivity";

describe("support safety rules", () => {
  it("escala un cargo desconocido con prioridad alta", () => {
    expect(classifySensitivity("No reconozco este cargo")).toMatchObject({
      category: "cargo_desconocido",
      priority: "high",
    });
  });

  it("escala una solicitud explícita de operación financiera", () => {
    expect(classifySensitivity("Compra acciones con mi dinero")).toMatchObject({
      category: "operacion_sensible",
      priority: "high",
    });
  });

  it("detecta asesoría de inversión personalizada", () => {
    expect(requestsPersonalizedInvestmentAdvice("¿En qué invierto mi dinero?")).toBe(true);
  });

  it("no marca como sensible una pregunta informativa normal", () => {
    expect(classifySensitivity("¿Cómo actualizo mi correo?")).toBeNull();
  });
  it.each(["Me cobraron dos veces", "No me llegó la transferencia", "Me debitaron de más"])(
    "escala una incidencia financiera coloquial: %s",
    (message) => {
      expect(classifySensitivity(message)).toMatchObject({
        category: "reclamo",
        priority: "high",
      });
    },
  );
  it.each([
    "ESTOY ENOJADISIMA",
    "Estoy muy enojada",
    "que porqueria de servicio",
    "este bot es estupido",
  ])("detecta expresiones de enojo o lenguaje inadecuado: %s", (message) => {
    expect(classifySensitivity(message)).toMatchObject({
      category: "reclamo",
      priority: "high",
    });
  });
});

describe("investment boundaries", () => {
  it.each([
    "¿Tesla o Bitcoin?",
    "¿En qué debería invertir mi sueldo?",
    "Tengo 500 dólares, ¿qué acción compro?",
    "¿Cuál inversión me conviene?",
  ])("bloquea una recomendación personalizada: %s", (message) => {
    expect(requestsPersonalizedInvestmentAdvice(message)).toBe(true);
  });

  it.each([
    "Ejecuta la inversión",
    "Compra acciones con mis 500 dólares",
    "Invierte este dinero por mí",
  ])("escala una ejecución sensible: %s", (message) => {
    expect(classifySensitivity(message)).toMatchObject({
      category: "operacion_sensible",
      priority: "high",
    });
  });

  it("no bloquea una consulta educativa general como consejo personalizado", () => {
    expect(requestsPersonalizedInvestmentAdvice("¿Cómo funciona invertir en bolsa?")).toBe(false);
  });
});
