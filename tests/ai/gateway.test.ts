import { afterEach, describe, expect, it, vi } from "vitest";

import {
  DEFAULT_MODEL,
  GROQ_STRUCTURED_OPTIONS,
  STRUCTURED_MODEL,
  getConfiguredGroqApiKeys,
  withGroqKeyFailover,
} from "@/lib/ai/gateway.server";

const originalEnvironment = {
  GROQ_API_KEY: process.env.GROQ_API_KEY,
  GROQ_API_KEY_2: process.env.GROQ_API_KEY_2,
  GROQ_API_KEY_3: process.env.GROQ_API_KEY_3,
  GROQ_API_KEYS: process.env.GROQ_API_KEYS,
  AI_MODEL: process.env.AI_MODEL,
  AI_STRUCTURED_MODEL: process.env.AI_STRUCTURED_MODEL,
};

afterEach(() => {
  for (const [name, value] of Object.entries(originalEnvironment)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

describe("Groq key failover", () => {
  it("separa el modelo conversacional del modelo estructurado", () => {
    expect(DEFAULT_MODEL).toBe(process.env.AI_MODEL ?? "llama-3.3-70b-versatile");
    expect(STRUCTURED_MODEL).toBe(process.env.AI_STRUCTURED_MODEL ?? "openai/gpt-oss-120b");
    expect(GROQ_STRUCTURED_OPTIONS).toEqual({
      groq: { structuredOutputs: true, strictJsonSchema: true },
    });
  });

  it("permite sobrescribir únicamente el modelo estructurado", async () => {
    process.env.AI_STRUCTURED_MODEL = "custom/structured-model";
    vi.resetModules();
    const gateway = await import("@/lib/ai/gateway.server");
    expect(gateway.STRUCTURED_MODEL).toBe("custom/structured-model");
  });
  it("combina la clave principal y las adicionales sin duplicados", () => {
    process.env.GROQ_API_KEY = "key-primary";
    process.env.GROQ_API_KEY_2 = "key-secondary";
    process.env.GROQ_API_KEYS = "key-secondary, key-third";

    expect(getConfiguredGroqApiKeys()).toEqual(["key-primary", "key-secondary", "key-third"]);
  });

  it("prueba la siguiente clave cuando la primera recibe 429", async () => {
    process.env.GROQ_API_KEY = "rate-limited-key";
    process.env.GROQ_API_KEY_2 = "available-key";
    delete process.env.GROQ_API_KEY_3;
    delete process.env.GROQ_API_KEYS;

    const attemptedKeyIndexes: number[] = [];

    const result = await withGroqKeyFailover(async (_model, context) => {
      attemptedKeyIndexes.push(context.keyIndex);

      if (context.keyIndex === 0) {
        throw {
          statusCode: 429,
          responseHeaders: { "retry-after": "60" },
        };
      }

      return "ok";
    });

    expect(result).toBe("ok");
    expect(attemptedKeyIndexes).toEqual([0, 1]);
  });

  it("no rota por un error 400 que otra clave no puede corregir", async () => {
    process.env.GROQ_API_KEY = "bad-request-key-a";
    process.env.GROQ_API_KEY_2 = "bad-request-key-b";
    delete process.env.GROQ_API_KEY_3;
    delete process.env.GROQ_API_KEYS;

    const attemptedKeyIndexes: number[] = [];

    await expect(
      withGroqKeyFailover(async (_model, context) => {
        attemptedKeyIndexes.push(context.keyIndex);
        throw { statusCode: 400 };
      }),
    ).rejects.toMatchObject({ statusCode: 400 });

    expect(attemptedKeyIndexes).toHaveLength(1);
  });
});
