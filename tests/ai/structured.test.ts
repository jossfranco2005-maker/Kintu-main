import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

const { generateTextMock, model, outputDefinition, failoverMock, outputObjectMock } = vi.hoisted(
  () => ({
    generateTextMock: vi.fn(),
    model: { id: "mock-groq-model" },
    outputDefinition: { type: "object-output" },
    failoverMock: vi.fn(),
    outputObjectMock: vi.fn(() => ({ type: "object-output" })),
  }),
);

vi.mock("ai", () => ({
  generateText: generateTextMock,
  Output: {
    object: outputObjectMock,
  },
}));

vi.mock("@/lib/ai/gateway.server", () => ({
  STRUCTURED_MODEL: "openai/gpt-oss-120b",
  GROQ_STRUCTURED_OPTIONS: {
    groq: {
      structuredOutputs: true,
      strictJsonSchema: true,
    },
  },
  GROQ_JSON_OPTIONS: { groq: { structuredOutputs: false } },
  withGroqKeyFailover: failoverMock,
}));

import { generateStructured } from "@/lib/ai/structured.server";

describe("generateStructured", () => {
  beforeEach(() => {
    generateTextMock.mockReset();
    failoverMock.mockReset();
    failoverMock.mockImplementation(
      (operation: (selectedModel: typeof model) => unknown, modelId: string) => {
        expect(modelId).toBe("openai/gpt-oss-120b");
        return operation(model);
      },
    );
  });

  it("usa el modelo y opciones strict para Output.object", async () => {
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
            structuredOutputs: true,
            strictJsonSchema: true,
          },
        },
        output: outputDefinition,
      }),
    );
    expect(failoverMock).toHaveBeenCalledWith(expect.any(Function), "openai/gpt-oss-120b");
    expect(outputObjectMock).toHaveBeenCalledWith({ schema });
  });
});
