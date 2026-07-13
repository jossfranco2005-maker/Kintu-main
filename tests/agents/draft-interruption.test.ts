import { describe, expect, it } from "vitest";

import { shouldInterruptTransactionDraft } from "@/lib/agents/draft-interruption";

describe("transaction draft interruption", () => {
  it("interrumpe por un cargo no reconocido", () => {
    expect(shouldInterruptTransactionDraft("No reconozco un cargo de 85 dólares.")).toBe(true);
  });

  it("interrumpe por una operación financiera sensible", () => {
    expect(shouldInterruptTransactionDraft("Compra acciones con mi dinero.")).toBe(true);
  });

  it("interrumpe por una consulta institucional", () => {
    expect(shouldInterruptTransactionDraft("¿Cómo cambio mi correo?")).toBe(true);
  });

  it("interrumpe por una solicitud de recomendación personalizada", () => {
    expect(shouldInterruptTransactionDraft("¿En qué invierto mi dinero?")).toBe(true);
  });

  it.each(["en KFC", "McDonald's", "ayer", "20 dólares", "transporte"])(
    "permite completar el borrador con %s",
    (message) => {
      expect(shouldInterruptTransactionDraft(message)).toBe(false);
    },
  );
});
