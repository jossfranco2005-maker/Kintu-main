import { describe, expect, it } from "vitest";

import { identityReplyForMessage } from "@/lib/agents/orchestrator";

describe("basic conversational tone", () => {
  it.each(["¿Qué eres?", "¿Qué es Kintu?"])("presenta Kintu sin saludo repetido: %s", (text) => {
    const reply = identityReplyForMessage(text);
    expect(reply).toBe(
      "Soy Kintu, un asistente financiero que te ayuda a registrar movimientos, revisar presupuestos y resolver consultas.",
    );
    expect(reply).not.toMatch(/^hola/i);
  });
});
