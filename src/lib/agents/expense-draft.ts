import type { ExpenseDraft, MissingExpenseField } from "@/lib/agents/schemas";
import { CATEGORIES, formatMoney } from "@/lib/finance/categorize";
import { formatIsoDateInSpanish } from "@/lib/finance/date";

const CATEGORY_LABELS: Record<string, string> = {
  comida: "Comida",
  transporte: "Transporte",
  hogar: "Hogar",
  salud: "Salud",
  educacion: "Educación",
  entretenimiento: "Entretenimiento",
  servicios: "Servicios",
  ropa: "Ropa",
  otros: "Otros",
};

function sentenceList(items: string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} y ${items.at(-1)}`;
}

export function getMissingExpenseFields(draft: ExpenseDraft): MissingExpenseField[] {
  const missing: MissingExpenseField[] = [];

  if (draft.amount === null || draft.amount <= 0) {
    missing.push("amount");
  }
  if (!draft.date) {
    missing.push("date");
  }
  if (draft.type === "expense" && !draft.category) {
    missing.push("category");
  }
  if (!draft.merchant) {
    missing.push("merchant");
  }

  return missing;
}

export function formatAvailableCategories(userCategories = new Set<string>()): string {
  const fixed = CATEGORIES.map((category) => CATEGORY_LABELS[category] ?? category);
  const fixedNormalized = new Set(CATEGORIES as readonly string[]);
  const custom = [...userCategories]
    .map((category) => category.trim())
    .filter(Boolean)
    .filter((category) => !fixedNormalized.has(category.toLowerCase()))
    .sort((first, second) => first.localeCompare(second, "es"))
    .slice(0, 8)
    .map((category) => category.charAt(0).toUpperCase() + category.slice(1));

  return sentenceList([...fixed, ...custom]);
}

export function questionForMissingField(
  field: MissingExpenseField,
  type: "income" | "expense",
  userCategories = new Set<string>(),
): string {
  switch (field) {
    case "amount":
      return type === "income"
        ? "¿Cuál fue el monto del ingreso?"
        : "¿Cuál fue el monto del gasto?";
    case "date":
      return "¿Cuándo ocurrió? Puedes responder hoy, ayer o una fecha concreta.";
    case "category":
      return (
        `¿En qué categoría lo registramos? Puedes elegir ${formatAvailableCategories(userCategories)}. ` +
        "También puedes escribir una nueva, como Mascotas."
      );
    case "merchant":
      return type === "income"
        ? "¿De quién o de dónde provino el ingreso?"
        : "¿Dónde o a quién realizaste el pago?";
  }
}

function missingFieldLabel(field: MissingExpenseField, type: "income" | "expense"): string {
  switch (field) {
    case "amount":
      return "el monto";
    case "date":
      return "la fecha";
    case "category":
      return "la categoría";
    case "merchant":
      return type === "income" ? "el origen" : "el lugar o destinatario del pago";
  }
}

export function understoodSummary(draft: ExpenseDraft): string {
  const kind = draft.type === "income" ? "ingreso" : "gasto";
  const parts: string[] = [];

  if (draft.amount) parts.push(`de ${formatMoney(draft.amount)}`);
  if (draft.category && draft.type === "expense") parts.push(`en ${draft.category}`);
  if (draft.date) parts.push(`con fecha ${formatIsoDateInSpanish(draft.date)}`);
  if (draft.merchant) {
    parts.push(
      draft.type === "income" ? `proveniente de ${draft.merchant}` : `en ${draft.merchant}`,
    );
  }

  return parts.length > 0 ? `Entendí un ${kind} ${parts.join(", ")}.` : `Entendí un ${kind}.`;
}

export function buildDraftProgressReply(
  draft: ExpenseDraft,
  needs: MissingExpenseField[],
  userCategories = new Set<string>(),
): string {
  if (needs.length === 0) return "";

  const missing = sentenceList(needs.map((field) => missingFieldLabel(field, draft.type)));
  const missingVerb = needs.length === 1 ? "Me falta" : "Me faltan";
  return `${understoodSummary(draft)} ${missingVerb} ${missing}. ${questionForMissingField(
    needs[0],
    draft.type,
    userCategories,
  )}`;
}

export function firstTransactionWelcome(
  _draft: ExpenseDraft & { needs: MissingExpenseField[] },
  nextQuestion: string,
): string {
  return `¡Hola! Soy Kintu, tu asistente financiero 🌱. ${nextQuestion}`;
}
