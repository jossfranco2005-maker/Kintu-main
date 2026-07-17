import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import { SYSTEM_BASE } from "@/lib/agents/schemas";
import { generateStructured } from "@/lib/ai/structured.server";
import { formatMoney, normalizeCategory } from "@/lib/finance/categorize";
import { firstOfMonth, nextMonthStart } from "@/lib/finance/budget";
import { monthRangeForIsoDate, shiftIsoDate } from "@/lib/finance/date";
import { requestsPersonalizedInvestmentAdvice } from "@/lib/finance/sensitivity";
import {
  buildDeterministicFinancialSummary,
  buildFinancialInsightCandidates,
  summarizeInsightTransactions,
  type FinancialInsightCandidate,
  type FinancialInsightSnapshot,
  type InsightBudget,
  type InsightTransaction,
} from "@/lib/finance/insights";

export const InsightSelectionSchema = z.object({
  selected_ids: z.array(z.string()).max(2),
  closing: z.string().max(160).nullable(),
});

export const HypotheticalExpenseSchema = z.object({
  amount: z.number().positive().nullable(),
  category: z.string().nullable(),
});

export const FinancialResponsePlanSchema = z.object({
  fact_ids: z.array(z.string()).max(20),
  coverage: z.enum(["single", "summary", "exhaustive"]),
  style: z.enum(["brief", "normal", "simple", "explanatory"]),
  format: z.enum([
    "sentence",
    "short_paragraph",
    "bullet_list",
    "numbered_steps",
    "summary_with_bullets",
  ]),
  answer: z.string().max(1000).nullable(),
  introduction: z.string().max(400).nullable(),
  items: z.array(z.string().max(400)).max(20),
  closing: z.string().max(400).nullable(),
});

export type VerifiedFinancialFact = { id: string; text: string; critical?: boolean };
export type FinancialResponsePlan = z.infer<typeof FinancialResponsePlanSchema>;

export function buildVerifiedFinancialFacts(
  snapshot: FinancialInsightSnapshot,
): VerifiedFinancialFact[] {
  const facts: VerifiedFinancialFact[] = [
    { id: "total_income", text: `Ingresos del mes: ${formatMoney(snapshot.current.income)}.` },
    { id: "total_expense", text: `Gastos del mes: ${formatMoney(snapshot.current.expense)}.` },
    { id: "net", text: `Balance neto del mes: ${formatMoney(snapshot.current.net)}.` },
  ];

  const expenses = Object.entries(
    snapshot.current.expenseByCategory ?? snapshot.current.byCategory,
  ).sort((a, b) => b[1] - a[1]);
  expenses.forEach(([category, amount], index) => {
    facts.push({
      id: `expense_category:${category}`,
      text: `${index === 0 ? "La categoría de mayor gasto" : "Gasto"} en ${category}: ${formatMoney(amount)}.`,
    });
  });

  Object.entries(snapshot.current.incomeByCategory ?? {})
    .sort((a, b) => b[1] - a[1])
    .forEach(([category, amount], index) => {
      facts.push({
        id: `income_category:${category}`,
        text: `${index === 0 ? "La categoría de mayor ingreso" : "Ingreso"} en ${category}: ${formatMoney(amount)}.`,
      });
    });

  snapshot.budgets.forEach((budget) => {
    const spent = snapshot.current.byCategory[budget.category] ?? 0;
    const percentage = budget.limitAmount > 0 ? Math.round((spent / budget.limitAmount) * 100) : 0;
    const difference = budget.limitAmount - spent;
    facts.push({
      id: `budget:${budget.category}`,
      critical: difference < 0,
      text:
        `Presupuesto de ${budget.category}: llevas ${formatMoney(spent)} de ${formatMoney(budget.limitAmount)} (${percentage}%). ` +
        (difference >= 0
          ? `Te faltan ${formatMoney(difference)} para llegar al límite.`
          : `Excedes el límite por ${formatMoney(Math.abs(difference))}.`),
    });
  });

  return facts;
}

export function renderVerifiedFacts(
  facts: VerifiedFinancialFact[],
  style: z.infer<typeof FinancialResponsePlanSchema>["style"],
): string {
  if (facts.length === 0) return "No tengo datos confirmados que respondan esa pregunta.";
  const selected = style === "brief" ? facts.slice(0, 1) : facts;
  if (style === "simple")
    return `En palabras simples: ${selected.map((fact) => fact.text).join(" ")}`;
  if (style === "explanatory")
    return `La conclusión sale de estos datos confirmados: ${selected.map((fact) => fact.text).join(" ")}`;
  return selected.map((fact) => fact.text).join(" ");
}

function numericValues(text: string): number[] {
  return [...text.matchAll(/\b(?:\d{1,3}(?:[.,]\d{3})+(?:[.,]\d{1,2})?|\d+(?:[.,]\d+)?)\b/g)]
    .map((match) => {
      const raw = match[0];
      const lastComma = raw.lastIndexOf(",");
      const lastDot = raw.lastIndexOf(".");
      const decimalIndex = Math.max(lastComma, lastDot);
      const decimalDigits = decimalIndex >= 0 ? raw.length - decimalIndex - 1 : 0;
      if (decimalDigits === 1 || decimalDigits === 2) {
        return Number(
          `${raw.slice(0, decimalIndex).replace(/[.,]/g, "")}.${raw.slice(decimalIndex + 1)}`,
        );
      }
      return Number(raw.replace(/[.,]/g, ""));
    })
    .filter(Number.isFinite);
}

function responseParts(plan: FinancialResponsePlan): string[] {
  return [plan.answer, plan.introduction, ...(plan.items ?? []), plan.closing]
    .map((part) => part?.trim())
    .filter((part): part is string => Boolean(part));
}

export function validateFinancialResponsePlan(params: {
  plan: FinancialResponsePlan;
  availableFacts: VerifiedFinancialFact[];
}): { selected: VerifiedFinancialFact[]; text: string } | null {
  const { plan, availableFacts } = params;
  const byId = new Map(availableFacts.map((fact) => [fact.id, fact]));
  if (plan.fact_ids.length === 0 || plan.fact_ids.some((id) => !byId.has(id))) return null;

  const selected = [...new Set(plan.fact_ids)].map((id) => byId.get(id)!);
  const parts = responseParts(plan);
  if (parts.length === 0) return null;
  if (plan.coverage === "single" && selected.length !== 1) return null;

  if (plan.coverage === "exhaustive") {
    const selectedExpenseCategories = selected.filter((fact) =>
      fact.id.startsWith("expense_category:"),
    );
    const allExpenseCategories = availableFacts.filter((fact) =>
      fact.id.startsWith("expense_category:"),
    );
    if (
      allExpenseCategories.length === 0 ||
      selectedExpenseCategories.length !== allExpenseCategories.length ||
      allExpenseCategories.some((fact) => !selected.some((item) => item.id === fact.id))
    ) {
      return null;
    }

    const combinedText = parts.join("\n").toLocaleLowerCase("es");
    if (
      selectedExpenseCategories.some(
        (fact) => !combinedText.includes(fact.id.slice("expense_category:".length).toLowerCase()),
      )
    ) {
      return null;
    }

    const categoryTotal = selectedExpenseCategories.reduce(
      (sum, fact) => sum + (numericValues(fact.text).at(0) ?? 0),
      0,
    );
    const expenseTotalFact = availableFacts.find((fact) => fact.id === "total_expense");
    const expenseTotal = expenseTotalFact ? numericValues(expenseTotalFact.text).at(0) : undefined;
    if (expenseTotal === undefined || Math.abs(categoryTotal - expenseTotal) > 0.01) return null;
  }
  if (
    selected.length === 1 &&
    ["bullet_list", "numbered_steps", "summary_with_bullets"].includes(plan.format)
  ) {
    return null;
  }

  const combined = parts.join("\n");
  const allowedNumbers = numericValues(selected.map((fact) => fact.text).join(" "));
  if (numericValues(combined).some((value) => !allowedNumbers.includes(value))) return null;
  if (
    /\b(?:abri|abrí|cree|creé|guarde|guardé|registre|registré|ejecute|ejecuté)\b/i.test(combined)
  ) {
    return null;
  }
  if (requestsPersonalizedInvestmentAdvice(combined)) return null;

  for (const critical of selected.filter((fact) => fact.critical)) {
    const criticalNumbers = numericValues(critical.text);
    const responseNumbers = numericValues(combined);
    if (criticalNumbers.some((value) => !responseNumbers.includes(value))) return null;
  }

  const introduction = plan.introduction?.trim();
  const answer = plan.answer?.trim();
  const closing = plan.closing?.trim();
  let text: string;
  if (plan.format === "bullet_list" || plan.format === "summary_with_bullets") {
    text = [introduction, ...(plan.items ?? []).map((item) => `- ${item.trim()}`), closing]
      .filter(Boolean)
      .join("\n");
  } else if (plan.format === "numbered_steps") {
    text = [
      introduction,
      ...(plan.items ?? []).map((item, index) => `${index + 1}. ${item.trim()}`),
      closing,
    ]
      .filter(Boolean)
      .join("\n");
  } else {
    text = [answer ?? introduction, ...(plan.items ?? []), closing].filter(Boolean).join("\n\n");
  }

  return text.trim() ? { selected, text: text.trim() } : null;
}

function renderCompleteExpenseCategoryBreakdown(facts: VerifiedFinancialFact[]): string {
  return facts
    .filter((fact) => fact.id.startsWith("expense_category:"))
    .map((fact) => `- ${fact.text}`)
    .join("\n");
}

export async function buildHypotheticalBudgetReply(params: {
  supabase: SupabaseClient;
  userId: string;
  userText: string;
}): Promise<string> {
  const snapshot = await loadFinancialInsightSnapshot(params);
  let extracted: z.infer<typeof HypotheticalExpenseSchema> = { amount: null, category: null };

  try {
    extracted = await generateStructured({
      name: "hypothetical-expense",
      schema: HypotheticalExpenseSchema,
      system: SYSTEM_BASE,
      prompt: `Extrae el monto y la categoría del escenario hipotético. No calcules nada y usa null si no hay evidencia.\n\nMensaje: ${params.userText}`,
    });
  } catch (error) {
    console.error("[insight-agent] Error extracting hypothetical scenario:", error);
  }

  const fallbackAmount = Number(
    params.userText.match(/(?:\$|USD\s*)?(\d+(?:[.,]\d{1,2})?)/i)?.[1]?.replace(",", "."),
  );
  const amount = extracted.amount ?? (fallbackAmount > 0 ? fallbackAmount : null);
  const categoryInput = (extracted.category ?? "").trim().toLowerCase();
  const category =
    snapshot.budgets.find((item) => item.category.toLowerCase() === categoryInput)?.category ??
    normalizeCategory(extracted.category ?? params.userText);
  if (!amount || !category) {
    return "Entendí que es una simulación, pero necesito el monto y la categoría para calcularla.";
  }

  const budget = snapshot.budgets.find((item) => item.category === category);
  const current = snapshot.current.byCategory[category] ?? 0;
  const projected = current + amount;
  if (!budget) {
    return `Simulación: en ${category} llevarías ${formatMoney(projected)} después de sumar ${formatMoney(amount)}. No tienes un presupuesto mensual definido para esa categoría.`;
  }

  const percentage = (projected / budget.limitAmount) * 100;
  const difference = budget.limitAmount - projected;
  const state =
    difference >= 0
      ? `te quedarían ${formatMoney(difference)}`
      : `excederías el límite por ${formatMoney(Math.abs(difference))}`;
  return `Simulación: en ${category} llevarías ${formatMoney(projected)}, el ${Math.round(percentage)}% de tu presupuesto de ${formatMoney(budget.limitAmount)}; ${state}. No registré ninguna transacción.`;
}

function safeClosing(value: string | null | undefined): string | null {
  const closing = value?.trim();
  if (!closing) return null;

  // La frase final no puede introducir cifras, montos ni porcentajes nuevos.
  if (/\d|\$|\busd\b|%/i.test(closing)) return null;

  return closing;
}

export function selectValidInsightCandidates(
  candidates: FinancialInsightCandidate[],
  selectedIds: string[],
): FinancialInsightCandidate[] {
  const byId = new Map(candidates.map((candidate) => [candidate.id, candidate]));
  const selected: FinancialInsightCandidate[] = [];

  for (const id of selectedIds) {
    const candidate = byId.get(id);
    if (!candidate || selected.some((item) => item.id === candidate.id)) continue;
    selected.push(candidate);
    if (selected.length === 2) break;
  }

  return selected.length > 0 ? selected : candidates.slice(0, 2);
}

export async function loadFinancialInsightSnapshot(params: {
  supabase: SupabaseClient;
  userId: string;
}): Promise<FinancialInsightSnapshot> {
  const { supabase, userId } = params;
  const month = firstOfMonth();
  const monthEnd = nextMonthStart(month);
  const previousMonth = monthRangeForIsoDate(shiftIsoDate(month, -1)).start;

  const [{ data: currentRows }, { data: previousRows }, { data: budgetRows }] = await Promise.all([
    supabase
      .from("transactions")
      .select("type, amount, category")
      .eq("user_id", userId)
      .eq("status", "confirmed")
      .gte("date", month)
      .lt("date", monthEnd),
    supabase
      .from("transactions")
      .select("type, amount, category")
      .eq("user_id", userId)
      .eq("status", "confirmed")
      .gte("date", previousMonth)
      .lt("date", month),
    supabase
      .from("budgets")
      .select("id, category, limit_amount, alert_threshold")
      .eq("user_id", userId)
      .eq("month", month),
  ]);

  const toTransactions = (
    rows: Array<{ type: string; amount: number | string; category: string }> | null,
  ): InsightTransaction[] =>
    (rows ?? [])
      .filter(
        (row): row is { type: "income" | "expense"; amount: number | string; category: string } =>
          row.type === "income" || row.type === "expense",
      )
      .map((row) => ({
        type: row.type,
        amount: Number(row.amount),
        category: row.category,
      }));

  const budgets: InsightBudget[] = (budgetRows ?? []).map((budget) => ({
    id: budget.id,
    category: budget.category,
    limitAmount: Number(budget.limit_amount),
    alertThreshold: Number(budget.alert_threshold),
  }));

  return {
    month,
    current: summarizeInsightTransactions(toTransactions(currentRows)),
    previous: summarizeInsightTransactions(toTransactions(previousRows)),
    budgets,
  };
}

export async function chooseInsightsWithModel(params: {
  userText: string;
  candidates: FinancialInsightCandidate[];
}): Promise<{ selected: FinancialInsightCandidate[]; closing: string | null }> {
  const { userText, candidates } = params;

  if (candidates.length <= 1) {
    return { selected: candidates, closing: null };
  }

  try {
    const result = await generateStructured({
      name: "insight-selection",
      schema: InsightSelectionSchema,
      system: SYSTEM_BASE,
      prompt: `Actúas como el agente de insights de Kintu.

Tu tarea NO es calcular ni inventar datos. El código ya generó observaciones verificadas.
Debes seleccionar como máximo dos observaciones que respondan mejor al mensaje del usuario.

Mensaje del usuario:
${userText}

Observaciones disponibles:
${candidates.map((candidate) => `- ${candidate.id}: ${candidate.title}`).join("\n")}

Reglas:
- Devuelve únicamente identificadores existentes.
- Prioriza riesgos de presupuesto y balance antes que comentarios positivos.
- closing debe ser una frase breve, cálida y sin cifras, montos, porcentajes ni recomendaciones de inversión.
- Si no hace falta cierre, usa null.`,
    });

    return {
      selected: selectValidInsightCandidates(candidates, result.selected_ids),
      closing: safeClosing(result.closing),
    };
  } catch (error) {
    console.error("[insight-agent] No se pudo priorizar con el modelo:", error);
    return { selected: candidates.slice(0, 2), closing: null };
  }
}

export async function buildPersonalizedFinancialReply(params: {
  supabase: SupabaseClient;
  userId: string;
  userText: string;
  conversationId?: string;
}): Promise<string> {
  const { supabase, userId, userText, conversationId } = params;
  const snapshot = await loadFinancialInsightSnapshot({ supabase, userId });
  const verifiedFacts = buildVerifiedFinancialFacts(snapshot);

  // Load conversation history if conversationId is available
  let history: Array<{ role: string; content: string }> = [];
  if (conversationId) {
    try {
      const { data: dbMessages } = await supabase
        .from("messages")
        .select("role, content")
        .eq("conversation_id", conversationId)
        .order("created_at", { ascending: true });
      if (dbMessages) {
        const historyOnly = dbMessages.slice(0, -1);
        history = historyOnly
          .map((m) => ({
            role: m.role,
            content: m.content,
          }))
          .slice(-6);
      }
    } catch (err) {
      console.error("[insight-agent] Error loading conversation history:", err);
    }
  }

  try {
    const plan = await generateStructured({
      name: "financial-response-plan",
      schema: FinancialResponsePlanSchema,
      system: SYSTEM_BASE,
      prompt: `Selecciona hechos verificados y redacta una respuesta natural usando exclusivamente esos hechos. No calcules cifras.

Mensaje actual: ${userText}
Historial reciente:
${history.map((m) => `${m.role}: ${m.content}`).join("\n")}

Hechos disponibles:
${verifiedFacts.map((fact) => `${fact.id}: ${fact.text}`).join("\n")}

Usa solo IDs existentes. Para seguimientos o preguntas sobre una conclusión anterior, usa el historial.
- coverage=single para una sola cifra; summary para una selección o un top solicitado; exhaustive cuando pide el desglose o distribución completa por categoría.
- Con coverage=exhaustive incluye todos los IDs expense_category disponibles, sin omitir ninguno.
- Si pide exactamente las tres categorías principales, usa coverage=summary y exactamente tres IDs expense_category.
- style=brief si pide ir al grano; simple si pide lenguaje sencillo; explanatory si pregunta por qué o cómo se llegó a una conclusión.
- format=sentence para una respuesta concreta; summary_with_bullets para varios indicadores; bullet_list para datos comparables; numbered_steps solo para un procedimiento real; short_paragraph para una explicación conceptual.
- answer, introduction, items y closing solo pueden parafrasear los hechos seleccionados.
- Copia montos, porcentajes y fechas exactamente; no agregues ninguna cifra.
- No uses Markdown ni HTML. Los items se renderizan después como texto plano.
- No afirmes que se guardó, creó o ejecutó una acción.`,
    });
    const validated = validateFinancialResponsePlan({ plan, availableFacts: verifiedFacts });
    if (validated) return validated.text;

    if (plan.coverage === "exhaustive") {
      const completeBreakdown = renderCompleteExpenseCategoryBreakdown(verifiedFacts);
      if (completeBreakdown) return completeBreakdown;
    }

    const byId = new Map(verifiedFacts.map((fact) => [fact.id, fact]));
    const selected = [...new Set(plan.fact_ids)]
      .map((id) => byId.get(id))
      .filter((fact): fact is VerifiedFinancialFact => Boolean(fact));
    return renderVerifiedFacts(selected, plan.style);
  } catch (error) {
    console.error("[insight-agent] Error generating personalized financial reply with LLM:", error);
    const candidates = buildFinancialInsightCandidates(snapshot);
    const selection = await chooseInsightsWithModel({
      userText,
      candidates,
    });
    return buildDeterministicFinancialSummary(snapshot, selection.selected, selection.closing);
  }
}
