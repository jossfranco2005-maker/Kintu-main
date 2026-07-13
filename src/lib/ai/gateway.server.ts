import { createGroq, type GroqLanguageModelOptions } from "@ai-sdk/groq";

export const DEFAULT_MODEL = process.env.AI_MODEL ?? "llama-3.3-70b-versatile";

function requiredEnvironmentVariable(name: string): string {
  const value = process.env[name]?.trim();

  if (!value) {
    throw new Error(`Missing environment variable: ${name}`);
  }

  return value;
}

let groqProvider: ReturnType<typeof createGroq> | undefined;

function getGroqProvider(): ReturnType<typeof createGroq> {
  if (!groqProvider) {
    groqProvider = createGroq({
      apiKey: requiredEnvironmentVariable("GROQ_API_KEY"),
    });
  }

  return groqProvider;
}

/**
 * Llama 3.3 usa JSON Object Mode en este proyecto.
 */
export const GROQ_JSON_OPTIONS = {
  groq: {
    structuredOutputs: false,
  } satisfies GroqLanguageModelOptions,
};

/**
 * Opciones para generateStructured (Output.object).
 * Output.object requiere structuredOutputs: true.
 */
export const GROQ_STRUCTURED_OPTIONS = {
  groq: {
    structuredOutputs: true,
  } satisfies GroqLanguageModelOptions,
};

/**
 * La clave se valida cuando realmente se solicita un modelo, no al importar
 * el módulo. Esto permite ejecutar pruebas deterministas sin exponer ni
 * requerir GROQ_API_KEY.
 */
export function getModel(modelId: string = DEFAULT_MODEL) {
  return getGroqProvider()(modelId);
}
