// Agente de notificaciones — server-only, best-effort.
// Se ejecuta después de cada turno del orquestador. Nunca debe romper el
// flujo del chat: cualquier error se registra y se descarta en silencio.
//
// LÓGICA: Solo evalúa la categoría del gasto que el usuario acaba de
// registrar en esta interacción. No barre todas las categorías para
// no generar alertas de cosas que el usuario no tocó ahora.
import { generateText } from "ai";
import type { SupabaseClient } from "@supabase/supabase-js";

import type { OrchestratorResult } from "@/lib/agents/orchestrator";
import { SYSTEM_BASE } from "@/lib/agents/schemas";
import { GROQ_JSON_OPTIONS, withGroqKeyFailover } from "@/lib/ai/gateway.server";
import { firstOfMonth, nextMonthStart } from "@/lib/finance/budget";

// Solo intenciones donde hay una señal financiera real que evaluar
const NOTIFIABLE_INTENTS = new Set(["expense", "budget", "support", "summary"]);

export type ChatNotificationInput = {
  supabase: SupabaseClient;
  userId: string;
  intent: string;
  text: string;
  result: OrchestratorResult;
};

/** Extrae un objeto JSON del texto aunque venga rodeado de markdown. */
function extractJson(raw: string): unknown {
  const fenceMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  const text = fenceMatch ? fenceMatch[1] : raw;
  const objMatch = text.match(/\{[\s\S]*\}/);
  if (!objMatch) throw new Error("No JSON found in response");
  return JSON.parse(objMatch[0]);
}

export async function maybeNotifyFromChat(input: ChatNotificationInput): Promise<void> {
  const { supabase, userId, intent, text, result } = input;

  if (!NOTIFIABLE_INTENTS.has(intent)) return;
  // Evita duplicar alertas automáticas de tickets
  if (result.ticket_id) return;

  // Solo procesamos si hay un draft con categoría definida (gasto/ingreso registrado)
  // o si es un resumen/soporte donde no hay categoría específica.
  const affectedCategory: string | null = result.draft?.category ?? null;

  // Para intenciones sin draft (summary/support) evaluamos el contexto general.
  // Para expense/budget SIEMPRE debemos tener una categoría; si no la hay, no notificamos.
  if (intent === "expense" && !affectedCategory) return;

  try {
    const month = firstOfMonth();
    const monthEnd = nextMonthStart(month);

    let budgetContext = "";
    let categoryStatus = "";

    if (affectedCategory) {
      // Solo cargamos el presupuesto de la categoría afectada
      const { data: budget } = await supabase
        .from("budgets")
        .select("id, category, limit_amount, alert_threshold")
        .eq("user_id", userId)
        .eq("month", month)
        .eq("category", affectedCategory)
        .maybeSingle();

      // Gastos acumulados en esa categoría este mes
      const { data: txs } = await supabase
        .from("transactions")
        .select("amount")
        .eq("user_id", userId)
        .eq("type", "expense")
        .eq("status", "confirmed")
        .eq("category", affectedCategory)
        .gte("date", month)
        .lt("date", monthEnd);

      const totalSpent = (txs ?? []).reduce((sum, t) => sum + Number(t.amount), 0);

      if (budget) {
        const limit = Number(budget.limit_amount);
        const pct = limit > 0 ? (totalSpent / limit) * 100 : 0;
        const remaining = limit - totalSpent;
        categoryStatus = `Categoría: ${affectedCategory}
Presupuesto definido: USD ${limit.toFixed(2)}
Gastado este mes: USD ${totalSpent.toFixed(2)} (${pct.toFixed(0)}%)
Restante: USD ${remaining.toFixed(2)}
${totalSpent > limit ? `⚠️ EXCEDIDO por USD ${(totalSpent - limit).toFixed(2)}` : ""}`;
      } else {
        categoryStatus = `Categoría: ${affectedCategory}
Sin presupuesto definido para esta categoría.
Gastado este mes en ${affectedCategory}: USD ${totalSpent.toFixed(2)}`;
      }

      budgetContext = `ESTADO DE LA CATEGORÍA AFECTADA:\n${categoryStatus}`;
    } else {
      // Para summary/support, damos un resumen general
      const { data: budgetsData } = await supabase
        .from("budgets")
        .select("category, limit_amount")
        .eq("user_id", userId)
        .eq("month", month);

      const { data: txsData } = await supabase
        .from("transactions")
        .select("category, amount")
        .eq("user_id", userId)
        .eq("type", "expense")
        .eq("status", "confirmed")
        .gte("date", month)
        .lt("date", monthEnd);

      const spentByCat: Record<string, number> = {};
      for (const t of txsData ?? []) {
        spentByCat[t.category] = (spentByCat[t.category] || 0) + Number(t.amount);
      }

      const overBudget = (budgetsData ?? [])
        .filter((b) => (spentByCat[b.category] ?? 0) > Number(b.limit_amount))
        .map(
          (b) =>
            `- ${b.category}: límite USD ${Number(b.limit_amount).toFixed(0)}, gastado USD ${(spentByCat[b.category] ?? 0).toFixed(2)}`,
        );

      if (overBudget.length === 0) return; // Nada urgente que notificar
      budgetContext = `CATEGORÍAS EXCEDIDAS:\n${overBudget.join("\n")}`;
    }

    const prompt = `Eres Kintu, un asistente financiero personal cálido y cercano.
El usuario acaba de registrar una interacción. Analiza si la situación puntual merece un aviso en su bandeja de notificaciones.

INTERACCIÓN ACTUAL:
Mensaje del usuario: "${text}"
Intención: "${intent}"${affectedCategory ? `\nCategoría del gasto registrado: ${affectedCategory}` : ""}
Respuesta del asistente: "${result.reply}"

${budgetContext}

REGLAS:
1. PRESUPUESTO EXCEDIDO → should_notify=true, level="urgent"
   Title: "🚨 Presupuesto agotado en [categoría]"
   Mensaje: menciona los números exactos (cuánto era el límite, cuánto lleva gastado, cuánto se pasó). Tono amable, no alarmista.
   Ejemplo: "Acabas de registrar un gasto en comida 🍽️ y ya llevas USD 323.00 gastados, superando tu límite de USD 200.00 por USD 123.00. Considera ajustar tu presupuesto si lo necesitas."

2. PRESUPUESTO AL 80%+ → should_notify=true, level="warning"
   Title: "⚠️ Casi al límite en [categoría]"
   Mensaje: porcentaje exacto y saldo restante. Tono amable.
   Ejemplo: "Llevas el 85% de tu presupuesto de transporte 🚌. Te quedan solo USD 15.00 de tus USD 100.00. Vas bien, solo tenlo en cuenta."

3. SIN PRESUPUESTO EN LA CATEGORÍA → should_notify=true, level="info"
   Title: "💡 Sin límite definido en [categoría]"
   Mensaje: total acumulado y sugerencia suave de crear un presupuesto.
   Ejemplo: "Llevas USD 45.00 gastados en entretenimiento este mes y aún no tienes un presupuesto para esta categoría. Considera definir uno en Presupuestos para tener mejor control 💚"

4. TODO BIEN → should_notify=false

IMPORTANTE: el mensaje debe ser entre 1 y 2 oraciones. Usa emojis con moderación (máximo 1-2). Menciona números exactos. Sé cálido, no exigente.

Responde SOLO con JSON sin markdown:
{"should_notify": true/false, "level": "info"|"warning"|"urgent"|null, "title": "..." o null, "message": "..." o null}`;

    const { text: raw } = await withGroqKeyFailover((model) =>
      generateText({
        model,
        maxRetries: 0,
        providerOptions: GROQ_JSON_OPTIONS,
        system: SYSTEM_BASE,
        prompt,
      }),
    );

    let decision: {
      should_notify: boolean;
      level?: string | null;
      title?: string | null;
      message?: string | null;
    };
    try {
      decision = extractJson(raw) as typeof decision;
    } catch {
      console.error("[notification-agent] Could not parse LLM response:", raw.slice(0, 200));
      return;
    }

    if (!decision.should_notify || !decision.message) return;

    const level = ["info", "warning", "urgent"].includes(decision.level ?? "")
      ? (decision.level as "info" | "warning" | "urgent")
      : "info";

    const { error } = await supabase.from("notifications").insert({
      user_id: userId,
      source: "chat_agent",
      level,
      title: decision.title ?? "Kintu",
      message: decision.message,
    });

    if (error) {
      console.error("[notification-agent] Error inserting notification:", error);
    }
  } catch (error) {
    console.error("[notification-agent] Error evaluating chat notification:", error);
  }
}
