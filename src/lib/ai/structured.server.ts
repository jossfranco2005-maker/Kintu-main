import { generateText, Output } from "ai";
import { z } from "zod";

import {
  GROQ_STRUCTURED_OPTIONS,
  STRUCTURED_MODEL,
  withGroqKeyFailover,
} from "@/lib/ai/gateway.server";

type StructuredGenerationInput<Schema extends z.ZodTypeAny> = {
  schema: Schema;
  prompt: string;
  system?: string;
  name?: string;
};

/**
 * Solicita un objeto JSON al modelo y valida el resultado
 * mediante el esquema Zod recibido.
 */
export async function generateStructured<Schema extends z.ZodTypeAny>(
  input: StructuredGenerationInput<Schema>,
): Promise<z.infer<Schema>> {
  const { schema, prompt, system } = input;

  try {
    const { output } = await withGroqKeyFailover(
      (model) =>
        generateText({
          model,
          maxRetries: 0,

          providerOptions: GROQ_STRUCTURED_OPTIONS,

          output: Output.object({
            schema,
          }),

          system,

          prompt: `
${prompt}

IMPORTANTE:
Responde exclusivamente con un objeto JSON válido.
No incluyas Markdown, bloques de código ni explicaciones
fuera del objeto JSON.
    `.trim(),
        }),
      STRUCTURED_MODEL,
    );

    return schema.parse(output);
  } catch (error) {
    const errorName = error instanceof Error ? error.name : "UnknownError";
    const errorRecord =
      error && typeof error === "object" ? (error as Record<string, unknown>) : null;
    const statusCode =
      typeof errorRecord?.statusCode === "number" ? errorRecord.statusCode : undefined;
    const detail =
      process.env.NODE_ENV !== "production" && error instanceof Error
        ? error.message.slice(0, 400)
        : undefined;
    const missingFields =
      error instanceof z.ZodError
        ? error.issues
            .filter((issue) => issue.code === "invalid_type" && issue.received === "undefined")
            .map((issue) => issue.path.join("."))
            .filter(Boolean)
            .slice(0, 12)
        : [];
    console.error("[structured-output] generation failed", {
      agent: input.name ?? "unnamed",
      model: STRUCTURED_MODEL,
      errorType: errorName,
      statusCode,
      missingFields,
      detail,
    });
    throw new Error(`Structured output failed for ${input.name ?? "unnamed"}.`);
  }
}
