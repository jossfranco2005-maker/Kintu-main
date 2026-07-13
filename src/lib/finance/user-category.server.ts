import type { SupabaseClient } from "@supabase/supabase-js";

import { detectCategory, normalizeCategory } from "@/lib/finance/categorize";
import { containsTransactionDateExpression } from "@/lib/finance/date";

function cleanCategory(value: string): string {
  return value.trim().toLowerCase();
}

function normalizeForSearch(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizeNewUserCategory(value: string): string | null {
  const cleaned = cleanCategory(value)
    .replace(/^(?:categor[ií]a\s*(?:es|:)?|para)\s+/i, "")
    .replace(/[.!?]+$/g, "")
    .trim();
  const normalized = normalizeForSearch(cleaned);

  if (!normalized || cleaned.length < 2 || cleaned.length > 40) return null;
  if (cleaned.split(/\s+/).length > 4) return null;
  if (containsTransactionDateExpression(cleaned)) return null;
  if (/^(?:si|sí|no|confirmar|guardar|cancelar|descartar|olvidalo|olvídalo)$/i.test(cleaned)) {
    return null;
  }
  if (/^(?:USD\s*|\$\s*)?\d+(?:[.,]\d{1,2})?(?:\s*(?:dolares|dólares|usd))?$/i.test(cleaned)) {
    return null;
  }
  if (/\b(?:gaste|gasté|pague|pagué|compre|compré|recibi|recibí|cobre|cobré)\b/i.test(cleaned)) {
    return null;
  }

  return cleaned;
}

export function detectUserBudgetCategory(
  text: string,
  budgetCategories: Set<string>,
): string | null {
  const normalizedText = ` ${normalizeForSearch(text)} `;
  const categories = [...budgetCategories].sort((a, b) => b.length - a.length);

  for (const category of categories) {
    const normalizedCategory = normalizeForSearch(category);
    if (normalizedCategory && normalizedText.includes(` ${normalizedCategory} `)) {
      return cleanCategory(category);
    }
  }

  return null;
}

export async function loadUserBudgetCategories(params: {
  supabase: SupabaseClient;
  userId: string;
}): Promise<Set<string>> {
  const budgetPromise = params.supabase
    .from("budgets")
    .select("category")
    .eq("user_id", params.userId);
  const transactionPromise = params.supabase
    .from("transactions")
    .select("category")
    .eq("user_id", params.userId)
    .eq("status", "confirmed");

  const [budgetResult, transactionResult] = await Promise.allSettled([
    budgetPromise,
    transactionPromise,
  ]);
  const categories = new Set<string>();
  const errors: string[] = [];

  if (budgetResult.status === "fulfilled") {
    if (budgetResult.value.error) errors.push(budgetResult.value.error.message);
    else {
      for (const row of budgetResult.value.data || []) {
        const category = normalizeNewUserCategory(row.category);
        if (category) categories.add(category);
      }
    }
  } else {
    errors.push(String(budgetResult.reason));
  }

  if (transactionResult.status === "fulfilled") {
    if (transactionResult.value.error) {
      console.error(
        "[user-category] No se pudieron consultar categorías de movimientos:",
        transactionResult.value.error,
      );
    } else {
      for (const row of transactionResult.value.data || []) {
        const category = normalizeNewUserCategory(row.category);
        if (category) categories.add(category);
      }
    }
  } else {
    console.error(
      "[user-category] No se pudieron consultar categorías de movimientos:",
      transactionResult.reason,
    );
  }

  if (categories.size === 0 && errors.length > 0) {
    throw new Error(`No se pudieron consultar las categorías del usuario: ${errors.join("; ")}`);
  }

  return categories;
}

export function resolveCategoryFromBudgetSet(
  input: string,
  budgetCategories: Set<string>,
  options: { allowNewCategory?: boolean } = {},
): string {
  const cleaned = cleanCategory(input);
  if (budgetCategories.has(cleaned)) return cleaned;

  const fixed = detectCategory(cleaned);
  if (fixed) return fixed;

  if (options.allowNewCategory) {
    const custom = normalizeNewUserCategory(cleaned);
    if (custom) return custom;
  }

  return normalizeCategory(cleaned);
}

export async function resolveUserCategory(params: {
  supabase: SupabaseClient;
  userId: string;
  input: string;
  allowNewCategory?: boolean;
}): Promise<string> {
  const categories = await loadUserBudgetCategories(params);
  return resolveCategoryFromBudgetSet(params.input, categories, {
    allowNewCategory: params.allowNewCategory,
  });
}
