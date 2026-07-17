import type { ExpenseDraft, MissingExpenseField } from "@/lib/agents/schemas";
import { CATEGORIES, detectCategory } from "@/lib/finance/categorize";
import {
  detectUserBudgetCategory,
  normalizeNewUserCategory,
} from "@/lib/finance/user-category.server";
import { containsTransactionDateExpression, resolveTransactionDate } from "@/lib/finance/date";

export type TransactionFieldPatch = {
  amount?: number | null;
  date?: string | null;
  category?: string | null;
  merchant?: string | null;
  description?: string | null;
};

export type ResolveTransactionFieldsInput = {
  text: string;
  type: "income" | "expense";
  currentDraft?: ExpenseDraft;
  missingFields?: MissingExpenseField[];
  llmPatch?: TransactionFieldPatch;
  userCategories?: Set<string>;
  today?: string;
};

function cleanText(value: string | null | undefined): string | null {
  const cleaned = value
    ?.trim()
    .replace(/[.!?]+$/g, "")
    .trim();
  return cleaned ? cleaned : null;
}

function normalize(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function hasLexicalCategoryEvidence(text: string, category: string): boolean {
  const normalizedCategory = normalize(category);
  if (normalizedCategory.length < 5) return false;
  const stem = normalizedCategory.slice(0, 5);
  return normalize(text)
    .split(/[^a-z0-9]+/)
    .some((token) => token.length >= 5 && token.startsWith(stem));
}

export function extractPositiveAmount(text: string): number | null {
  const withoutDates = text
    .replace(/\b\d{4}-\d{2}-\d{2}\b/g, " ")
    .replace(/\b\d{1,2}[/-]\d{1,2}(?:[/-]\d{2,4})?\b/g, " ");
  const match = withoutDates.match(/(?:\bUSD\s*|\$\s*)?(\d+(?:[.,]\d{1,2})?)\b/i);
  if (!match) return null;

  const parsed = Number(match[1].replace(",", "."));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function isControlMessage(text: string): boolean {
  const normalized = normalize(text);
  return /^(?:si|no|confirmar|confirma|guardar|guarda|cancelar|cancela|descartar|descarta|olvidalo|dejalo)$/.test(
    normalized,
  );
}

function isAmountOnly(text: string): boolean {
  return /^(?:USD\s*|\$\s*)?\d+(?:[.,]\d{1,2})?(?:\s*(?:dolares|dólares|usd))?$/i.test(text.trim());
}

function stripTemporalSuffix(text: string): string {
  return text
    .replace(
      /\s+(?:hoy|ayer|anteayer|el\s+(?:lunes|martes|miercoles|miércoles|jueves|viernes|sabado|sábado|domingo)|este\s+(?:lunes|martes|miercoles|miércoles|jueves|viernes|sabado|sábado|domingo)|el\s+(?:lunes|martes|miercoles|miércoles|jueves|viernes|sabado|sábado|domingo)\s+pasado)\s*$/i,
      "",
    )
    .trim();
}

function extractExplicitCategoryCandidate(
  text: string,
  allowPurposeCategory: boolean,
): string | null {
  const explicit = text.match(
    /\bcategor[ií]a\s*(?:es|:)?\s+([\p{L}][\p{L}\s-]{1,38}?)(?=$|\s+(?:en|a|con|por)\b|[,.!?])/iu,
  )?.[1];
  if (explicit) return explicit.trim();

  if (allowPurposeCategory) {
    const purpose = text.match(
      /\bpara\s+([\p{L}-]{2,30})(?=$|\s+(?:en|a|con|por)\b|[,.!?])/iu,
    )?.[1];
    if (purpose && !/^(?:mi|mis|un|una|el|la|los|las)$/i.test(purpose)) {
      return purpose.trim();
    }
  }

  // En frases como "gasté 20 en mascotas en Veterinaria Luna", el segmento
  // intermedio describe la categoría y el último el lugar del pago.
  const betweenPlaces = text.match(/\ben\s+([\p{L}][\p{L}\s-]{1,38}?)\s+en\s+/iu)?.[1];
  return betweenPlaces?.trim() ?? null;
}

function isStandaloneCategoryAnswer(text: string): boolean {
  const cleaned = text
    .trim()
    .replace(/[.!?]+$/g, "")
    .trim();
  if (!cleaned || cleaned.length > 40 || cleaned.split(/\s+/).length > 4) return false;
  if (/^(?:en|a|de|desde)\s+/i.test(cleaned)) return false;
  if (/\b(?:gaste|gasté|pague|pagué|compre|compré|recibi|recibí|cobre|cobré)\b/i.test(cleaned)) {
    return false;
  }
  return true;
}

export function resolveCategoryCandidate(params: {
  text: string;
  llmCategory?: string | null;
  userCategories?: Set<string>;
  expectingCategory?: boolean;
  allowNewCategory?: boolean;
  allowModelInference?: boolean;
  allowPurposeCategory?: boolean;
}): string | null {
  const {
    text,
    llmCategory,
    userCategories = new Set<string>(),
    expectingCategory = false,
    allowNewCategory = false,
    allowModelInference = true,
    allowPurposeCategory = true,
  } = params;

  // La evidencia literal del usuario tiene prioridad sobre una clasificación
  // genérica del modelo (por ejemplo, evita que "Mascotas" termine en "otros").
  const existingFromText = detectUserBudgetCategory(text, userCategories);
  if (existingFromText) return existingFromText;

  const fixedFromText = detectCategory(text);
  if (fixedFromText) return fixedFromText;

  if (allowNewCategory) {
    const explicit = extractExplicitCategoryCandidate(text, allowPurposeCategory);
    const standalone =
      expectingCategory && isStandaloneCategoryAnswer(text) ? cleanText(text) : null;
    const fromUserText = explicit ?? standalone;
    if (fromUserText) {
      const custom = normalizeNewUserCategory(fromUserText);
      if (custom) return custom;
    }
  }

  if (!allowModelInference) return null;

  const existingFromModel = detectUserBudgetCategory(llmCategory ?? "", userCategories);
  if (existingFromModel) return existingFromModel;

  const fixedFromModel = detectCategory(llmCategory ?? "");
  if (fixedFromModel) return fixedFromModel;

  if (allowNewCategory && llmCategory) {
    const normalizedModelCategory = normalize(llmCategory);
    const normalizedText = normalize(text);
    if (
      expectingCategory ||
      normalizedText.includes(normalizedModelCategory) ||
      hasLexicalCategoryEvidence(text, llmCategory)
    ) {
      return normalizeNewUserCategory(llmCategory);
    }
  }

  return null;
}

function merchantIsForbidden(params: {
  candidate: string;
  originalText: string;
  userCategories: Set<string>;
  resolvedCategory: string | null;
}): boolean {
  const { candidate, originalText, userCategories, resolvedCategory } = params;
  const normalizedCandidate = normalize(candidate);

  if (isControlMessage(candidate) || isAmountOnly(candidate)) return true;
  if (containsTransactionDateExpression(candidate) && !/\b(?:en|a|de|desde)\s+/i.test(candidate)) {
    return true;
  }

  const fixedCategory = (CATEGORIES as readonly string[]).some(
    (category) => normalize(category) === normalizedCandidate,
  );
  const existingCategory = [...userCategories].some(
    (category) => normalize(category) === normalizedCandidate,
  );
  if (fixedCategory || existingCategory) return true;
  if (resolvedCategory && normalizedCandidate === normalize(resolvedCategory)) return true;

  // Evita que una respuesta compuesta únicamente por una fecha o un monto
  // termine como comercio aunque el LLM la haya colocado en merchant.
  if (
    normalize(originalText) === normalizedCandidate &&
    (containsTransactionDateExpression(originalText) || isAmountOnly(originalText))
  ) {
    return true;
  }

  return false;
}

function cleanMerchantCandidate(params: {
  value: string | null | undefined;
  originalText: string;
  userCategories: Set<string>;
  resolvedCategory: string | null;
}): string | null {
  const cleaned = cleanText(params.value)
    ?.replace(
      /^(?:hoy|ayer|anteayer|el\s+(?:lunes|martes|miercoles|miércoles|jueves|viernes|sabado|sábado|domingo))\s+(?:en|a)\s+/i,
      "",
    )
    .replace(/^(?:fue\s+|era\s+)?(?:en|a|de|desde)\s+/i, "")
    .replace(
      /^(?:el\s+)?(?:comercio|origen)\s+(?:de\s+)?(?:la\s+)?(?:transacci[oó]n|operaci[oó]n|movimiento|gasto|ingreso)(?:\s+pendiente)?\s+(?:es|fue|era)\s+/i,
      "",
    )
    .replace(/^(?:comercio|tienda|local|establecimiento|lugar|origen)\s*[:-]?\s*/i, "")
    .replace(/\s+por\s+.+$/i, "")
    .trim();

  if (!cleaned || cleaned.length < 2) return null;
  if (merchantIsForbidden({ ...params, candidate: cleaned })) return null;
  return cleaned;
}

function extractExpenseMerchant(text: string): string | null {
  const withoutDate = stripTemporalSuffix(text.replace(/[.!?]+$/g, "").trim());

  const enSegments = withoutDate
    .split(/\ben\b/i)
    .map((segment) => segment.trim())
    .filter(Boolean);
  if (enSegments.length > 1) {
    return (enSegments.at(-1) ?? "").replace(/\s+por\s+.+$/i, "").trim() || null;
  }

  const recipient = withoutDate.match(
    /\b(?:pague|pagué|di|entregue|entregué)\s+(?:a\s+)?(.+)$/i,
  )?.[1];
  if (recipient && !isAmountOnly(recipient)) return recipient.trim();

  const explicit = withoutDate.match(
    /\b(?:comercio|tienda|local|establecimiento|lugar)\s*(?:es|fue|:)?\s*(.+)$/i,
  )?.[1];
  return explicit?.trim() ?? null;
}

function extractIncomeOrigin(text: string): string | null {
  const withoutDate = stripTemporalSuffix(text.replace(/[.!?]+$/g, "").trim());

  const forRecipient = withoutDate.match(/\bpara\s+([\p{L}][\p{L}\s.'-]{1,60})$/iu)?.[1];
  if (forRecipient) return forRecipient.trim();

  const deSegments = withoutDate.split(/\bde\b/i).map((segment) => segment.trim());
  if (deSegments.length >= 3 && deSegments.at(-1)) return deSegments.at(-1)!;

  const explicit = withoutDate.match(
    /\b(?:provino|vino|llego|llegó)\s+(?:de|desde)\s+(.+?)(?=\s+por\b|$)/i,
  )?.[1];
  if (explicit) return explicit.trim();

  const from = withoutDate.match(/\b(?:de|desde)\s+(.+?)(?=\s+por\b|$)/i)?.[1];
  if (from) return from.trim();

  // "Me pagaron 100 por un trabajo freelance": aquí "por..." es el origen
  // cuando no se proporcionó una persona o empresa con "de/des­de".
  const reason = withoutDate.match(/\bpor\s+(.+)$/i)?.[1];
  return reason?.trim() ?? null;
}

function extractIncomeCategoryEvidence(text: string): string | null {
  const purpose = text.match(
    /\bpor\s+(?:un|una)?\s*(?:trabajo\s+)?([\p{L}-]{3,30})(?=\s+(?:que|de|para)\b|[,.!?]|$)/iu,
  )?.[1];
  if (purpose) return normalizeNewUserCategory(purpose);

  const sourceKind = text.match(
    /\bde\s+([\p{L}-]{3,30})\s+de\s+[\p{L}][\p{L}\s.'-]{1,60}(?=[,.!?]|$)/iu,
  )?.[1];
  return sourceKind ? normalizeNewUserCategory(sourceKind) : null;
}

function extractDeterministicMerchant(params: {
  text: string;
  type: "income" | "expense";
  allowBareMerchant: boolean;
}): string | null {
  const { text, type, allowBareMerchant } = params;
  const explicit = type === "income" ? extractIncomeOrigin(text) : extractExpenseMerchant(text);
  if (explicit) return explicit;

  if (!allowBareMerchant) return null;
  return cleanText(text);
}

function extractDescription(text: string, type: "income" | "expense"): string | null {
  const explicit = text.match(/\b(?:descripci[oó]n|detalle|nota)\s*(?:es|:)?\s*(.+)$/i)?.[1];
  if (explicit) return stripTemporalSuffix(explicit).trim() || null;

  if (type === "expense") {
    const reason = text.match(/\bpor\s+(.+?)(?=\s+(?:hoy|ayer|anteayer)\b|$)/i)?.[1];
    if (reason && !isAmountOnly(reason)) return reason.trim();
  }

  if (type === "income" && /\b(?:de|desde)\s+.+?\s+por\s+/i.test(text)) {
    const reason = text.match(/\bpor\s+(.+?)(?=\s+(?:hoy|ayer|anteayer)\b|$)/i)?.[1];
    if (reason) return reason.trim();
  }

  return null;
}

export function resolveTransactionFields(input: ResolveTransactionFieldsInput): ExpenseDraft {
  const {
    text,
    type,
    currentDraft,
    llmPatch = {},
    userCategories = new Set<string>(),
    today,
  } = input;
  const missingFields = input.missingFields ?? ["amount", "date", "category", "merchant"];
  const firstMissing = missingFields[0] ?? null;

  const amount =
    currentDraft?.amount ??
    (typeof llmPatch.amount === "number" && llmPatch.amount > 0 ? llmPatch.amount : null) ??
    (missingFields.includes("amount") || !currentDraft ? extractPositiveAmount(text) : null);

  const date =
    currentDraft?.date ??
    (missingFields.includes("date") || !currentDraft
      ? resolveTransactionDate(llmPatch.date, text, today)
      : null);

  const resolvedCategory =
    currentDraft?.category ??
    (type === "income" ? extractIncomeCategoryEvidence(text) : null) ??
    resolveCategoryCandidate({
      text,
      llmCategory: llmPatch.category,
      userCategories,
      expectingCategory: firstMissing === "category",
      allowNewCategory: true,
      // La salida estructurada puede aportar cualquier campo faltante, no
      // solamente el primero que la interfaz preguntó.
      allowModelInference: !currentDraft,
      allowPurposeCategory: type === "expense",
    });
  const category = type === "income" ? (resolvedCategory ?? "otros") : resolvedCategory;

  const allowBareMerchant =
    firstMissing === "merchant" ||
    (missingFields.length === 1 && missingFields.includes("merchant"));
  const deterministicMerchant = extractDeterministicMerchant({
    text,
    type,
    allowBareMerchant,
  });
  const merchantFromLlm = cleanMerchantCandidate({
    value: llmPatch.merchant,
    originalText: text,
    userCategories,
    resolvedCategory: category,
  });
  const merchantFromRules = cleanMerchantCandidate({
    value: deterministicMerchant,
    originalText: text,
    userCategories,
    resolvedCategory: category,
  });
  const merchant = currentDraft?.merchant ?? merchantFromLlm ?? merchantFromRules;

  const llmDescription = cleanText(llmPatch.description);
  const description =
    currentDraft?.description ?? llmDescription ?? extractDescription(text, type) ?? null;

  return {
    type,
    amount,
    currency: "USD",
    date,
    category,
    merchant,
    description,
  };
}
