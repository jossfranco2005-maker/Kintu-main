import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

const { generateTextMock, model, outputDefinition } = vi.hoisted(() => ({
  generateTextMock: vi.fn(),
  model: { id: "mock-groq-model" },
  outputDefinition: { type: "object-output" },
}));

vi.mock("ai", () => ({
  generateText: generateTextMock,
  Output: {
    object: vi.fn(() => outputDefinition),
  },
}));

vi.mock("@/lib/ai/gateway.server", () => ({
  GROQ_JSON_OPTIONS: {
    groq: {
      structuredOutputs: false,
    },
  },
  withGroqKeyFailover: vi.fn((operation: (selectedModel: typeof model) => unknown) =>
    operation(model),
  ),
}));

import { generateStructured } from "@/lib/ai/structured.server";

describe("generateStructured", () => {
  beforeEach(() => {
    generateTextMock.mockReset();
  });

  it("usa JSON Object Mode con validacion estructurada", async () => {
    generateTextMock.mockResolvedValue({ output: { category: "expense" } });

    const schema = z.object({ category: z.string() });
    const result = await generateStructured({ schema, prompt: "Clasifica el mensaje" });

    expect(result).toEqual({ category: "expense" });
    expect(generateTextMock).toHaveBeenCalledWith(
      expect.objectContaining({
        model,
        maxRetries: 0,
        providerOptions: {
          groq: {
            structuredOutputs: false,
          },
        },
        output: outputDefinition,
      }),
    );
  });
});
