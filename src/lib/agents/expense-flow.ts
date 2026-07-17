import { z } from "zod";

import {
  applyExpenseCorrection,
  extractDeterministicExpenseCorrection,
  type ExpenseCorrectionPatch,
} from "@/lib/agents/expense-correction";
import { buildDraftProgressReply, getMissingExpenseFields } from "@/lib/agents/expense-draft";
import {
  resolveTransactionFields,
  type TransactionFieldPatch,
} from "@/lib/agents/transaction-field-resolver";
import { generateStructured } from "@/lib/ai/structured.server";
import {
  EXPENSE_EXTRACT_PROMPT,
  ExpenseExtractSchema,
  SYSTEM_BASE,
  type ExpenseDraft,
  type MissingExpenseField,
} from "@/lib/agents/schemas";
import { detectCategory } from "@/lib/finance/categorize";
import {
  detectUserBudgetCategory,
  normalizeNewUserCategory,
} from "@/lib/finance/user-category.server";
import {
  formatIsoDateInSpanish,
  inspectTransactionDateIssue,
  resolveTransactionDate,
  todayInEcuador,
} from "@/lib/finance/date";
import { detectsDistress } from "@/lib/finance/sensitivity";

export type ExpenseFlowInput = {
  text: string;
  transactionType?: "income" | "expense" | null;
  userCategories?: Set<string>;
  today?: string;
};

export type CompleteExpenseFlowInput = {
  text: string;
  currentDraft: ExpenseDraft;
  userCategories?: Set<string>;
  history?: Array<{ role: string; content: string }>;
};

export type ReviseExpenseFlowInput = CompleteExpenseFlowInput;

export type ExpenseFlowResult = {
  reply: string;

  draft?: ExpenseDraft & {
    needs: MissingExpenseField[];
  };
};

export const ExpenseFollowUpSchema = z.object({
  amount: z.number().positive().nullable(),
  date: z.string().nullable(),
  category: z.string().nullable(),
  merchant: z.string().nullable(),
  description: z.string().nullable(),
});

export const ExpenseCorrectionSchema = z.object({
  type: z.enum(["income", "expense"]).nullable(),
  amount: z.number().positive().nullable(),
  date: z.string().nullable(),
  category: z.string().nullable(),
  merchant: z.string().nullable(),
  description: z.string().nullable(),
});

function cleanNullableText(value: string | null | undefined): string | null {
  const cleaned = value?.trim();
  return cleaned ? cleaned : null;
}

function inferTransactionType(text: string): "income" | "expense" {
  return /\b(?:me pagaron|me pago|recibi|recibí|cobre|cobré|gane|gané|ingreso|sueldo|salario|venta)\b/i.test(
    text,
  )
    ? "income"
    : "expense";
}

function buildExpenseFlowResult(
  draft: ExpenseDraft,
  userCategories = new Set<string>(),
  prefix = "",
): ExpenseFlowResult {
  const needs = getMissingExpenseFields(draft);

  if (needs.length > 0) {
    return {
      reply: prefix + buildDraftProgressReply(draft, needs, userCategories),
      draft: {
        ...draft,
        needs,
      },
    };
  }

  const kind = draft.type === "income" ? "ingreso" : "gasto";

  return {
    reply: `${prefix}Preparé este ${kind}. Revisa los datos y confirma si están correctos:`,
    draft: {
      ...draft,
      needs: [],
    },
  };
}

/**
 * Inicia un nuevo ingreso o gasto desde un mensaje completo.
 */
export async function handleExpenseFlow(input: ExpenseFlowInput): Promise<ExpenseFlowResult> {
  const {
    text,
    transactionType,
    userCategories = new Set<string>(),
    today = todayInEcuador(),
  } = input;
  let extracted: z.infer<typeof ExpenseExtractSchema> | null = null;

  try {
    extracted = await generateStructured({
      name: "transaction-extraction",
      schema: ExpenseExtractSchema,
      system: SYSTEM_BASE,
      prompt: `
${EXPENSE_EXTRACT_PROMPT}

Fecha actual de Ecuador:
${today}

Tipo detectado previamente por el clasificador:
${transactionType ?? "desconocido"}

Si el tipo detectado es income o expense, respétalo.

Mensaje del usuario:
${text}
      `.trim(),
    });
  } catch (error) {
    console.error(
      "[expense-flow] Error extracting transaction; using deterministic fallback:",
      error,
    );
  }

  const type = transactionType ?? extracted?.type ?? inferTransactionType(text);
  const draft = resolveTransactionFields({
    text,
    type,
    llmPatch: extracted ?? undefined,
    userCategories,
    today,
  });
  const dateIssue = inspectTransactionDateIssue(text, today);
  if (dateIssue?.kind === "future_without_year" && dateIssue.suggestedDate) {
    const result = buildExpenseFlowResult(draft, userCategories);
    return {
      ...result,
      reply:
        `El ${formatIsoDateInSpanish(dateIssue.mentionedDate!)} todavía no ha ocurrido. ` +
        `Como indicas que la transacción ya se realizó, ¿te refieres al ${formatIsoDateInSpanish(dateIssue.suggestedDate)}?`,
    };
  }
  if (dateIssue?.kind === "future_explicit") {
    const result = buildExpenseFlowResult(draft, userCategories);
    return {
      ...result,
      reply:
        `La fecha ${formatIsoDateInSpanish(dateIssue.mentionedDate!)} todavía no ha ocurrido, ` +
        "pero el mensaje describe una transacción realizada. Confirma o corrige la fecha.",
    };
  }
  if (dateIssue?.kind === "invalid") {
    const result = buildExpenseFlowResult(draft, userCategories);
    return { ...result, reply: "Esa fecha no existe. Indícame una fecha válida." };
  }
  const empathy = detectsDistress(text) ? "Entiendo. Lo registramos con calma. " : "";

  return buildExpenseFlowResult(draft, userCategories, empathy);
}

/**
 * Completa un borrador existente con una respuesta corta.
 */
export async function completeExpenseFlow(
  input: CompleteExpenseFlowInput,
): Promise<ExpenseFlowResult> {
  const { text, currentDraft, userCategories = new Set<string>(), history = [] } = input;
  const currentNeeds = getMissingExpenseFields(currentDraft);

  let patch: TransactionFieldPatch = {
    amount: null,
    date: null,
    category: null,
    merchant: null,
    description: null,
  };

  try {
    patch = await generateStructured({
      name: "transaction-follow-up",
      schema: ExpenseFollowUpSchema,
      system: SYSTEM_BASE,
      prompt: `
Existe una transacción pendiente.

BORRADOR ACTUAL:
${JSON.stringify(currentDraft, null, 2)}

CAMPOS QUE FALTAN:
${JSON.stringify(currentNeeds)}

RESPUESTA DEL USUARIO:
${text}

HISTORIAL RECIENTE:
${history.map((message) => `${message.role}: ${message.content}`).join("\n") || "(vacío)"}

Extrae únicamente los datos que aporta esta respuesta para completar los campos faltantes.

Ejemplos:
- "en KFC" significa merchant="KFC"
- "ayer" aporta una fecha y nunca un merchant
- "20 dólares" aporta amount=20 y nunca un merchant
- "transporte" aporta category="transporte"
- una categoría nueva como "Mascotas" puede ir en category
- "ayer en KFC" aporta date y merchant
- Si el turno anterior pidió confirmar el año de una fecha y el usuario lo confirma, devuelve la fecha ISO completa.

No inventes valores. Usa null cuando la respuesta no aporte ese dato.
      `.trim(),
    });
  } catch (error) {
    console.error("[expense-flow] Error completing draft; using deterministic fallback:", error);
  }

  const completedDraft = resolveTransactionFields({
    text,
    type: currentDraft.type,
    currentDraft,
    missingFields: currentNeeds,
    llmPatch: patch,
    userCategories,
  });

  return buildExpenseFlowResult(completedDraft, userCategories);
}

/**
 * Corrige un borrador existente, incluso cuando ya estaba listo para confirmar.
 * Solo reemplaza campos mencionados explícitamente por el usuario.
 */
export async function reviseExpenseFlow(input: ReviseExpenseFlowInput): Promise<ExpenseFlowResult> {
  const { text, currentDraft, userCategories = new Set<string>() } = input;
  const deterministic = extractDeterministicExpenseCorrection(text, {
    currentDraft,
    userCategories,
  });
  let patch: ExpenseCorrectionPatch = deterministic;
  const hasDeterministicCorrection = Object.values(deterministic).some((value) => value !== null);

  if (!hasDeterministicCorrection) {
    try {
      const extracted = await generateStructured({
        name: "transaction-correction",
        schema: ExpenseCorrectionSchema,
        system: SYSTEM_BASE,
        prompt: `Existe una transacción pendiente y el usuario quiere corregirla.

BORRADOR ACTUAL:
${JSON.stringify(currentDraft, null, 2)}

MENSAJE DE CORRECCIÓN:
${text}

Devuelve únicamente los campos que el usuario corrige de forma explícita.
Usa null en los demás.

Ejemplos:
- "no fueron 30, fueron 20" => amount=20
- "no fue ayer, fue hoy" => date de hoy
- "no fue KFC, fue Burger King" => merchant="Burger King"
- "no fue comida, fue Mascotas" => category="Mascotas"
- "cambia la descripción a almuerzo de trabajo" => description="almuerzo de trabajo"
- "no era gasto, era ingreso" => type="income"`,
      });

      const customCategory =
        deterministic.category ??
        detectUserBudgetCategory(extracted.category ?? "", userCategories) ??
        detectUserBudgetCategory(text, userCategories);
      const fixedCategory = detectCategory(extracted.category ?? "");
      const llmNewCategory = extracted.category
        ? normalizeNewUserCategory(extracted.category)
        : null;

      patch = {
        type: extracted.type,
        amount: extracted.amount,
        date: extracted.date ? resolveTransactionDate(extracted.date, text) : null,
        category: customCategory ?? fixedCategory ?? llmNewCategory,
        merchant: cleanNullableText(extracted.merchant),
        description: cleanNullableText(extracted.description),
      };
    } catch (error) {
      console.error("[expense-flow] Error revising draft; using deterministic correction:", error);
    }
  }

  const revised = applyExpenseCorrection(currentDraft, patch);
  const changed = JSON.stringify(revised) !== JSON.stringify(currentDraft);

  if (!changed) {
    return {
      reply:
        "No identifiqué qué dato deseas corregir. Puedes decir, por ejemplo: " +
        '"no fueron 30, fueron 20" o "no fue KFC, fue Burger King".',
      draft: {
        ...currentDraft,
        needs: getMissingExpenseFields(currentDraft),
      },
    };
  }

  return buildExpenseFlowResult(revised, userCategories, "Listo, corregí el borrador. ");
}
