import { createGroq, type GroqLanguageModelOptions } from "@ai-sdk/groq";

export const DEFAULT_MODEL = process.env.AI_MODEL ?? "llama-3.3-70b-versatile";

const DEFAULT_RATE_LIMIT_COOLDOWN_MS = 60_000;
const INVALID_KEY_COOLDOWN_MS = 60 * 60_000;

type GroqProvider = ReturnType<typeof createGroq>;
export type GroqModel = ReturnType<GroqProvider>;

type GroqKeyEntry = {
  apiKey: string;
  index: number;
  label: string;
};

type GroqAttemptContext = {
  keyIndex: number;
  keyLabel: string;
  modelId: string;
};

let nextKeyIndex = 0;
const blockedUntilByKey = new Map<string, number>();

function splitKeys(raw: string | undefined): string[] {
  return (raw ?? "")
    .split(/[\s,;]+/)
    .map((value) => value.trim())
    .filter(Boolean);
}

export function getConfiguredGroqApiKeys(): string[] {
  return Array.from(
    new Set([
      ...splitKeys(process.env.GROQ_API_KEY),
      ...splitKeys(process.env.GROQ_API_KEY_2),
      ...splitKeys(process.env.GROQ_API_KEY_3),
      ...splitKeys(process.env.GROQ_API_KEYS),
    ]),
  );
}

function getGroqKeyPool(): GroqKeyEntry[] {
  const keys = getConfiguredGroqApiKeys();

  if (keys.length === 0) {
    throw new Error("Missing Groq credentials. Configure GROQ_API_KEY or GROQ_API_KEYS.");
  }

  return keys.map((apiKey, index) => ({
    apiKey,
    index,
    label: `groq-key-${index + 1}(...${apiKey.slice(-4)})`,
  }));
}

function readStatusCode(error: unknown): number | undefined {
  if (!error || typeof error !== "object") return undefined;

  const record = error as Record<string, unknown>;
  if (typeof record.statusCode === "number") return record.statusCode;

  return (
    readStatusCode(record.lastError) ??
    readStatusCode(record.cause) ??
    (Array.isArray(record.errors)
      ? record.errors.map(readStatusCode).find((value) => value !== undefined)
      : undefined)
  );
}

function readResponseHeader(error: unknown, headerName: string): string | undefined {
  if (!error || typeof error !== "object") return undefined;

  const record = error as Record<string, unknown>;
  const headers = record.responseHeaders;

  if (headers instanceof Headers) {
    return headers.get(headerName) ?? undefined;
  }

  if (headers && typeof headers === "object") {
    const headerRecord = headers as Record<string, unknown>;
    const matchingKey = Object.keys(headerRecord).find(
      (key) => key.toLowerCase() === headerName.toLowerCase(),
    );
    const value = matchingKey ? headerRecord[matchingKey] : undefined;
    if (typeof value === "string") return value;
  }

  return (
    readResponseHeader(record.lastError, headerName) ??
    readResponseHeader(record.cause, headerName) ??
    (Array.isArray(record.errors)
      ? record.errors
          .map((nestedError) => readResponseHeader(nestedError, headerName))
          .find(Boolean)
      : undefined)
  );
}

function shouldTryNextGroqKey(error: unknown): boolean {
  const statusCode = readStatusCode(error);

  return (
    statusCode === 401 ||
    statusCode === 403 ||
    statusCode === 408 ||
    statusCode === 429 ||
    (statusCode !== undefined && statusCode >= 500)
  );
}

function getCooldownMs(error: unknown): number {
  const statusCode = readStatusCode(error);

  if (statusCode === 401 || statusCode === 403) {
    return INVALID_KEY_COOLDOWN_MS;
  }

  const retryAfter = readResponseHeader(error, "retry-after");
  const retryAfterSeconds = retryAfter ? Number.parseFloat(retryAfter) : Number.NaN;

  if (Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0) {
    return Math.ceil(retryAfterSeconds * 1_000);
  }

  return DEFAULT_RATE_LIMIT_COOLDOWN_MS;
}

function blockKeyTemporarily(entry: GroqKeyEntry, error: unknown): void {
  const cooldownMs = getCooldownMs(error);
  blockedUntilByKey.set(entry.apiKey, Date.now() + cooldownMs);

  console.warn(`[ai-gateway] ${entry.label} no disponible temporalmente; se probará otra clave.`);
}

/**
 * Ejecuta una llamada con una clave Groq y, ante errores de cuota,
 * autenticación o disponibilidad temporal, prueba la siguiente clave.
 *
 * La operación debe configurar maxRetries: 0 para evitar que AI SDK
 * reintente varias veces con la misma clave antes de que este gateway
 * pueda hacer el failover.
 */
export async function withGroqKeyFailover<T>(
  operation: (model: GroqModel, context: GroqAttemptContext) => Promise<T>,
  modelId: string = DEFAULT_MODEL,
): Promise<T> {
  const pool = getGroqKeyPool();
  let lastError: unknown;
  let availableKeys = 0;

  for (let offset = 0; offset < pool.length; offset += 1) {
    const poolIndex = (nextKeyIndex + offset) % pool.length;
    const entry = pool[poolIndex];
    const blockedUntil = blockedUntilByKey.get(entry.apiKey) ?? 0;

    if (blockedUntil > Date.now()) continue;

    availableKeys += 1;
    const provider = createGroq({ apiKey: entry.apiKey });

    try {
      const result = await operation(provider(modelId), {
        keyIndex: entry.index,
        keyLabel: entry.label,
        modelId,
      });

      nextKeyIndex = (poolIndex + 1) % pool.length;
      return result;
    } catch (error) {
      lastError = error;

      if (!shouldTryNextGroqKey(error)) {
        throw error;
      }

      blockKeyTemporarily(entry, error);
    }
  }

  if (availableKeys === 0) {
    throw new Error(
      "Todas las claves de Groq están temporalmente bloqueadas. Intenta nuevamente más tarde.",
      { cause: lastError },
    );
  }

  throw lastError instanceof Error
    ? lastError
    : new Error("No fue posible completar la solicitud con Groq.");
}

/**
 * Compatibilidad con código antiguo. Las llamadas nuevas deben usar
 * withGroqKeyFailover para poder cambiar de clave ante un error 429.
 */
export function getModel(modelId: string = DEFAULT_MODEL): GroqModel {
  const [entry] = getGroqKeyPool();
  return createGroq({ apiKey: entry.apiKey })(modelId);
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
