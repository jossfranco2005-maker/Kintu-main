import { generateText, Output } from "ai";
import { z } from "zod";

import { GROQ_JSON_OPTIONS, withGroqKeyFailover } from "@/lib/ai/gateway.server";

type StructuredGenerationInput<Schema extends z.ZodTypeAny> = {
  schema: Schema;
  prompt: string;
  system?: string;
};

/**
 * Solicita un objeto JSON al modelo y valida el resultado
 * mediante el esquema Zod recibido.
 */
export async function generateStructured<Schema extends z.ZodTypeAny>(
  input: StructuredGenerationInput<Schema>,
): Promise<z.infer<Schema>> {
  const { schema, prompt, system } = input;

  const { output } = await withGroqKeyFailover((model) =>
    generateText({
      model,
      maxRetries: 0,

      providerOptions: GROQ_JSON_OPTIONS,

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
  );

  return output;
}
