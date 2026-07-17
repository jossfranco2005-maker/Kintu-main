import type { ExpenseDraft } from "@/lib/agents/schemas";
import { CATEGORIES, detectCategory } from "@/lib/finance/categorize";
import {
  detectUserBudgetCategory,
  normalizeNewUserCategory,
} from "@/lib/finance/user-category.server";
import { containsTransactionDateExpression, resolveTransactionDate } from "@/lib/finance/date";

export type ExpenseCorrectionPatch = {
  type: "income" | "expense" | null;
  amount: number | null;
  date: string | null;
  category: string | null;
  merchant: string | null;
  description: string | null;
};

export type ExpenseCorrectionContext = {
  currentDraft?: ExpenseDraft;
  userCategories?: Set<string>;
};

function normalize(text: string): string {
  return text
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function lastPositiveNumber(text: string): number | null {
  const matches = [...text.matchAll(/\b(\d+(?:[.,]\d{1,2})?)\b/g)];
  const last = matches.at(-1)?.[1];

  if (!last) return null;

  const value = Number(last.replace(",", "."));
  return Number.isFinite(value) && value > 0 ? value : null;
}

function cleanMerchant(value: string, userCategories = new Set<string>()): string | null {
  const cleaned = value
    .replace(/[.!?]+$/g, "")
    .replace(/^(?:en|a|de|desde)\s+/i, "")
    .trim();

  if (!cleaned || cleaned.length < 2) return null;
  if (containsTransactionDateExpression(cleaned)) return null;
  const normalizedCleaned = normalize(cleaned);
  const exactFixedCategory = (CATEGORIES as readonly string[]).some(
    (category) => normalize(category) === normalizedCleaned,
  );
  const exactUserCategory = [...userCategories].some(
    (category) => normalize(category) === normalizedCleaned,
  );
  if (exactFixedCategory || exactUserCategory) return null;
  if (/^(?:USD\s*|\$\s*)?\d+(?:[.,]\d+)?(?:\s*(?:dolares|dólares|usd))?$/i.test(cleaned)) {
    return null;
  }

  return cleaned;
}

function extractCorrectedDate(text: string): string | null {
  const contrast = text.match(/\bno fue\s+([^,;]+)[,;]\s*(?:fue|era)\s+([^.!?]+)$/i);
  if (contrast?.[2] && containsTransactionDateExpression(contrast[2])) {
    return resolveTransactionDate(null, contrast[2]);
  }

  const explicit = text.match(/\b(?:fecha|d[ií]a)\s*(?:es|fue|:)?\s*([^.!?]+)$/i)?.[1];
  if (explicit) return resolveTransactionDate(null, explicit);

  const iso = text.match(/\b\d{4}-\d{2}-\d{2}\b/)?.[0] ?? null;
  return resolveTransactionDate(iso, text);
}

function extractCorrectedDescription(text: string): string | null {
  const match = text.match(
    /\b(?:cambia|cambiar|cambialo|cámbialo|cambiala|cámbiala|corrige|corregir)\s+(?:la\s+)?(?:descripci[oó]n|detalle|nota)\s+(?:a|por|:)?\s*([^.!?]+)$/i,
  );
  return match?.[1]?.trim() || null;
}

function parseContrast(text: string): { previous: string; next: string } | null {
  const match = text.match(/\bno fue\s+([^,.;]+)[,;]\s*(?:fue|era)\s+([^.!?]+)$/i);
  if (!match?.[1] || !match[2]) return null;
  return { previous: match[1].trim(), next: match[2].trim() };
}

function extractCorrectedCategory(text: string, context: ExpenseCorrectionContext): string | null {
  const userCategories = context.userCategories ?? new Set<string>();
  const explicit = text.match(
    /\b(?:categor[ií]a)\s*(?:es|fue|a|por|:)?\s*([^,;.!?]+?)(?=\s*(?:[,;]|(?:y\s+)?(?:el\s+)?(?:monto|importe|valor)\b|(?:y\s+)?(?:la\s+)?(?:fecha|descripci[oó]n|nota)\b|(?:y\s+)?(?:el\s+)?(?:d[ií]a|comercio|lugar|origen|destinatario|detalle)\b|[.!?]|$))/i,
  )?.[1];
  if (explicit) {
    return (
      detectUserBudgetCategory(explicit, userCategories) ??
      detectCategory(explicit) ??
      normalizeNewUserCategory(explicit)
    );
  }

  const contrast = parseContrast(text);
  if (contrast) {
    const previousNormalized = normalize(contrast.previous);
    const currentCategory = context.currentDraft?.category
      ? normalize(context.currentDraft.category)
      : null;
    const previousIsCategory = Boolean(
      detectCategory(contrast.previous) ||
      detectUserBudgetCategory(contrast.previous, userCategories) ||
      (currentCategory && previousNormalized === currentCategory),
    );

    if (previousIsCategory) {
      return (
        detectUserBudgetCategory(contrast.next, userCategories) ??
        detectCategory(contrast.next) ??
        normalizeNewUserCategory(contrast.next)
      );
    }
  }

  const changed = text.match(
    /\b(?:cambialo|cámbialo|cambiala|cámbiala|corrige(?:lo|la)?)\s+a\s+([^.!?]+)$/i,
  );
  if (changed?.[1]) {
    return detectUserBudgetCategory(changed[1], userCategories) ?? detectCategory(changed[1]);
  }

  return null;
}

function extractMerchantCorrection(
  text: string,
  context: ExpenseCorrectionContext,
  categoryCorrection: string | null,
): string | null {
  if (categoryCorrection) return null;

  const userCategories = context.userCategories ?? new Set<string>();
  const explicit = text.match(
    /\b(?:comercio|lugar|origen|destinatario)\s*(?:es|fue|:)?\s*([^,.!?]+)$/i,
  );
  if (explicit?.[1]) return cleanMerchant(explicit[1], userCategories);

  const contrast = parseContrast(text);
  if (contrast) {
    const previousNormalized = normalize(contrast.previous);
    const currentMerchant = context.currentDraft?.merchant
      ? normalize(context.currentDraft.merchant)
      : null;
    const previousLooksLikeOtherField = Boolean(
      containsTransactionDateExpression(contrast.previous) ||
      detectCategory(contrast.previous) ||
      detectUserBudgetCategory(contrast.previous, userCategories) ||
      /^\d+(?:[.,]\d+)?$/.test(contrast.previous.trim()),
    );

    if (
      (currentMerchant && previousNormalized === currentMerchant) ||
      !previousLooksLikeOtherField
    ) {
      return cleanMerchant(contrast.next, userCategories);
    }
  }

  const place = text.match(/\b(?:fue|era)\s+en\s+([^.!?]+)$/i);
  if (place?.[1]) return cleanMerchant(place[1], userCategories);

  return null;
}

export function extractDeterministicExpenseCorrection(
  text: string,
  context: ExpenseCorrectionContext = {},
): ExpenseCorrectionPatch {
  const normalized = normalize(text);
  const type = /\b(?:era|fue|es)\s+(?:un\s+)?ingreso\b/.test(normalized)
    ? "income"
    : /\b(?:era|fue|es)\s+(?:un\s+)?gasto\b/.test(normalized)
      ? "expense"
      : null;
  const description = extractCorrectedDescription(text);
  const date = description ? null : extractCorrectedDate(text);
  const category = description ? null : extractCorrectedCategory(text, context);

  return {
    type,
    amount: description ? null : lastPositiveNumber(text),
    date,
    category,
    merchant: description ? null : extractMerchantCorrection(text, context, category),
    description,
  };
}

export function applyExpenseCorrection(
  draft: ExpenseDraft,
  patch: ExpenseCorrectionPatch,
): ExpenseDraft {
  return {
    type: patch.type ?? draft.type,
    amount: patch.amount ?? draft.amount,
    currency: "USD",
    date: patch.date ?? draft.date,
    category: patch.category ?? draft.category,
    merchant: patch.merchant ?? draft.merchant,
    description: patch.description ?? draft.description,
  };
}
