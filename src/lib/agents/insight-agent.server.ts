import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { generateText } from "ai";

import { SYSTEM_BASE } from "@/lib/agents/schemas";
import { generateStructured } from "@/lib/ai/structured.server";
import { withGroqKeyFailover } from "@/lib/ai/gateway.server";
import { formatMoney } from "@/lib/finance/categorize";
import { firstOfMonth, nextMonthStart } from "@/lib/finance/budget";
import { monthRangeForIsoDate, shiftIsoDate } from "@/lib/finance/date";
import {
  buildDeterministicFinancialSummary,
  buildFinancialInsightCandidates,
  summarizeInsightTransactions,
  type FinancialInsightCandidate,
  type FinancialInsightSnapshot,
  type InsightBudget,
  type InsightTransaction,
} from "@/lib/finance/insights";

const InsightSelectionSchema = z.object({
  selected_ids: z.array(z.string()).max(2),
  closing: z.string().max(160).nullable(),
});

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

async function chooseInsightsWithModel(params: {
  userText: string;
  candidates: FinancialInsightCandidate[];
}): Promise<{ selected: FinancialInsightCandidate[]; closing: string | null }> {
  const { userText, candidates } = params;

  if (candidates.length <= 1) {
    return { selected: candidates, closing: null };
  }

  try {
    const result = await generateStructured({
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
    const systemPrompt = `Actúas como un analista financiero conversacional para Kintu. Tu objetivo es responder preguntas del usuario de forma precisa, natural, directa y concisa utilizando ÚNICAMENTE los datos financieros reales proporcionados.

DATOS FINANCIEROS REALES DEL USUARIO:
- Mes actual: ${snapshot.month}
- Ingresos totales del mes: ${formatMoney(snapshot.current.income)}
- Gastos totales del mes: ${formatMoney(snapshot.current.expense)}
- Balance neto (Ingresos - Gastos): ${formatMoney(snapshot.current.net)}
- Transacciones confirmadas este mes: ${snapshot.current.transactionCount}

DESGLOSE DE INGRESOS POR CATEGORÍA:
${JSON.stringify(snapshot.current.incomeByCategory || {}, null, 2)}

DESGLOSE DE GASTOS POR CATEGORÍA:
${JSON.stringify(snapshot.current.expenseByCategory || {}, null, 2)}

PRESUPUESTOS MENSUALES DEFINIDOS:
${JSON.stringify(
  snapshot.budgets.map((b) => ({
    categoría: b.category,
    límite: b.limitAmount,
    alerta: b.alertThreshold,
  })),
  null,
  2,
)}

HISTORIAL DE LA CONVERSACIÓN RECIENTE:
${history.map((m) => `${m.role === "user" ? "Usuario" : "Asistente"}: ${m.content}`).join("\n")}

REGLAS DE RESPUESTA:
1. COMPRENSIÓN DE CONTEXTO Y PREGUNTAS CORTAS:
   - Resuelve pronombres, elipsis y preguntas incompletas basándote en el historial de la conversación.
   - Si el usuario pregunta "¿y en cuál?", "¿pero en qué?", "¿cuál fue la mayor?", o "¿y la segunda?", asume que continúa preguntando sobre el desglose de ingresos o gastos del tema anterior y responde según los datos.

2. CONSULTAS DE INGRESOS:
   - Si pregunta "¿En qué he tenido más ingresos?", "¿Cuál es mi categoría con más ingresos?", "¿Qué categoría genera más dinero?", "¿Dónde gano más?" o similar (o preguntas de seguimiento sobre este tema):
     * Si no hay categorías de ingresos: responde exactamente "Todavía no tienes ingresos clasificados por categorías."
     * Si hay solo una categoría: nómbrala directamente con su monto en una frase corta y amigable, sin generar una lista (ej. "Tu única fuente de ingresos es Salario con USD 850.").
     * Si hay más de una categoría de ingresos: responde con un ranking descendente de las categorías, mencionando los montos (ej. "Tu categoría con mayores ingresos este mes es Salario con USD 850. Le siguen Freelance con USD 240 y Ventas con USD 110.").
   - NUNCA respondas únicamente con el balance o resumen mensual si la pregunta es sobre el desglose de ingresos.

3. CONSULTAS DE GASTOS:
   - Si pregunta en qué gasta más, su mayor gasto, o categorías de gastos:
     * Si no hay categorías de gastos: responde exactamente que todavía no tiene gastos clasificados.
     * Si hay solo una categoría: nómbrala directamente con su monto.
     * Si hay más de una categoría: devuelve el ranking de categorías de gasto correspondientes (orden descendente).

4. EVITAR RESPUESTAS GENÉRICAS Y REPETITIVAS:
   - No comiences ni repitas automáticamente "Este mes registras ingresos por X, gastos por Y..." a menos que el usuario esté pidiendo explícitamente un resumen general del mes o balance mensual.
   - Responde directamente a la pregunta específica del usuario con tono analítico y cercano.

5. PRIORIDAD DEL CONTEXTO:
   - Prioriza siempre analizar los datos financieros antes de responder. Solo di que no entiendes cuando la pregunta sea realmente ambigua y no tenga relación con finanzas o soporte técnico.`;

    const { text: reply } = await withGroqKeyFailover((model) =>
      generateText({
        model,
        maxRetries: 0,
        system: systemPrompt,
        prompt: `Mensaje del usuario: "${userText}"`,
      }),
    );

    return reply;
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
