import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";

import type { OrchestratorInput, OrchestratorResult } from "@/lib/agents/orchestrator";
import { rankKnowledgeArticles, type KnowledgeArticle } from "@/lib/agents/support-retrieval";
import { normalizeSupportRoutingText } from "@/lib/agents/support-routing";
import { SYSTEM_BASE } from "@/lib/agents/schemas";
import { generateStructured } from "@/lib/ai/structured.server";
import {
  buildPersonalizedFinancialReply,
  loadFinancialInsightSnapshot,
} from "@/lib/agents/insight-agent.server";
import { classifySensitivity, detectsDistress } from "@/lib/finance/sensitivity";
import type { FinancialInsightSnapshot, InsightBudget } from "@/lib/finance/insights";

const SupportAnswerSchema = z.object({
  can_answer: z.boolean(),
  answer: z.string().nullable(),
  used_article_ids: z.array(z.string()).max(3),
  missing_reason: z.string().nullable(),
});

type SupportAnswer = z.infer<typeof SupportAnswerSchema>;

// Recordatorio consistente en todo el flujo de soporte: ninguna respuesta
// automática (ni resumen de tu estado, ni pauta general) reemplaza a
// alguien de nuestro equipo cuando el tema es específico. Se agrega tanto
// en la respuesta "grounded" directa como en el Camino B de la bifurcación.
const CASE_NUDGE =
  "Si necesitás algo más puntual a tu situación, lo mejor es abrir un caso para que alguien de nuestro equipo te ayude directamente.";

// =========================================================
// ÚNICO CASO REALMENTE VETADO: pedir una recomendación de inversión
// específica y personalizada ("qué acciones compro", "recomiéndame un
// fondo", "cuánto debo invertir de mi sueldo"). Acá NUNCA se responde
// nada, ni siquiera se ofrece la bifurcación — se abre caso directo, sin
// preguntar. Esto es distinto de un interés general en el tema ("quiero
// invertir pero no sé por dónde empezar"), que sí sigue el flujo normal de
// soporte/educación más abajo.
// =========================================================
const SPECIFIC_INVESTMENT_ADVICE_PATTERN =
  /\b(en que (accion|acciones|fondo|fondos|activo|activos|instrumento|instrumentos|criptomoneda|cripto)|que (accion|acciones|fondo|fondos)|cual (accion|fondo)|cuanto (debo|deberia) invertir|recomiendame (una|un) (accion|fondo|inversion|cripto)|donde invierto|invierto en que|me recomiendas (una|un) (accion|fondo)|deberia comprar|deberia vender)\b/;

function requestsSpecificInvestmentAdvice(text: string): boolean {
  const normalized = normalizeSupportRoutingText(text);
  return SPECIFIC_INVESTMENT_ADVICE_PATTERN.test(normalized);
}

async function createInvestmentAdviceTicket(input: OrchestratorInput): Promise<OrchestratorResult> {
  const { supabase, userId, conversationId, text } = input;

  const { data: recentMessages, error: historyError } = await supabase
    .from("messages")
    .select("role, content, created_at")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: false })
    .limit(12);

  if (historyError) {
    console.error("[support-flow] Error reading conversation history:", historyError);
  }

  const summary = `Usuario pide una recomendación de inversión específica: "${text.slice(0, 240)}".`;

  const { data: ticket, error } = await supabase
    .from("tickets")
    .insert({
      user_id: userId,
      category: "investment_advice",
      priority: "medium",
      summary,
      context_json: {
        source: "chat",
        trigger: "specific_investment_advice_request",
        original_question: text,
        automation_executed: false,
      },
      conversation_json: (recentMessages || []).reverse(),
      status: "PENDING_HUMAN_REVIEW",
    })
    .select("id")
    .single();

  if (error || !ticket) {
    console.error("[support-flow] Error creating investment advice ticket:", error);
    return { reply: "No pude crear el caso. Probemos de nuevo en un momento." };
  }

  return {
    reply:
      "No puedo recomendarte qué comprar, vender o en qué invertir específicamente — eso requiere asesoría profesional personalizada. " +
      `Abrí un caso (#${ticket.id.slice(0, 8)}) para que alguien de nuestro equipo te ayude directamente con esto.`,
    ticket_id: ticket.id,
  };
}

// =========================================================
// BIFURCACIÓN: ticket vs. recomendación general
// =========================================================
// Cuando el agente no puede dar una respuesta aprobada con certeza, en vez
// de mandar directo a "escribe quiero hablar con una persona" (texto que el
// usuario tenía que copiar literal), le ofrecemos elegir. El estado
// "pendiente de elección" se guarda en el metadata del último mensaje del
// asistente (mismo mecanismo que ya usan los drafts de transacción vía
// draft_id) — no hace falta tabla nueva. chat.functions.ts y webhook.ts
// deben incluir `supportChoicePending` en el metadata que insertan en
// `messages` para que esto persista entre turnos.

function offerSupportChoice(pendingText: string, leadIn?: string): OrchestratorResult {
  const intro = leadIn ? `${leadIn} ` : "No tengo una respuesta certera para esto. ";
  return {
    reply:
      `${intro}Puedo:\n\n` +
      `1️⃣ Abrir un caso para que alguien de nuestro equipo te ayude directamente.\n` +
      `2️⃣ Darte información general con lo que tengo disponible por ahora.\n\n` +
      `¿Cuál preferís? Respondé "1" o "2".`,
    supportChoicePending: { pendingText },
  };
}

function parseSupportChoice(text: string): "ticket" | "recommendation" | null {
  const normalized = normalizeSupportRoutingText(text);
  if (
    /^\s*1\b/.test(normalized) ||
    /\b(caso|ticket|persona|equipo|humano|agente|asesor)\b/.test(normalized)
  ) {
    return "ticket";
  }
  if (
    /^\s*2\b/.test(normalized) ||
    /\b(recomendacion|informacion|consejo|general|info)\b/.test(normalized)
  ) {
    return "recommendation";
  }
  return null;
}

// Distingue "preguntas sobre mi propio estado financiero" (donde SÍ tiene
// sentido llamar al agente financiero con datos reales del usuario) de
// cualquier otro tema (inversión en general, procedimientos, dudas
// generales), donde mostrar el resumen de ingresos/gastos no responde
// nada — es justamente el bug que hacía que "quiero invertir en la bolsa"
// devolviera un resumen de presupuesto de comida sin relación con la
// pregunta.
export const OWN_STATE_PATTERN =
  /\b(mi balance|mis? (ingresos?|gastos?|movimientos?|finanzas|metas?|presupuestos?)|cuanto (llevo|gaste|gasto|gano|tengo|ahorre|ahorro|ahorrar)|presupuesto|ahorro|ahorrar|estado de (mi )?cuenta|resumen (del mes|financiero)?|como voy( este mes| con mis gastos)?)\b/;

export function looksLikeOwnStateQuestion(text: string): boolean {
  const normalized = normalizeSupportRoutingText(text);
  return OWN_STATE_PATTERN.test(normalized);
}

// Arma una pauta general a partir de artículos aprobados — nunca una
// recomendación específica o determinista ("comprá X", "vendé Y"). Se
// apoya en que el contenido de knowledge_articles ya pasó por aprobación
// (ver SYSTEM_BASE: "Está prohibido recomendar inversiones
// personalizadas"), así que alcanza con enmarcarlo explícitamente como
// información general y no como algo hecho a medida del usuario.
function buildGeneralGuidanceReply(articles: KnowledgeArticle[]): string {
  const body = articles.map((article) => article.content.trim()).join("\n\n");
  return `Esto es una pauta general, no una recomendación personalizada:\n\n${body}`;
}

const GeneralEducationSchema = z.object({
  answer: z.string(),
});

// Cuando no hay ningún artículo aprobado sobre el tema, en vez de rendirse
// con "no tengo información" (respuesta vacía e inútil que viste en la
// captura), generamos una explicación educativa general real — conceptos,
// no recomendaciones. Esto NUNCA se llama para pedidos de asesoría
// específica (esos ya se filtran antes, en requestsSpecificInvestmentAdvice)
// así que el modelo solo tiene que explicar, no recomendar.
async function generateGeneralEducationReply(
  topicText: string,
  financialSummary?: string,
): Promise<string | null> {
  try {
    const contextPrompt = financialSummary
      ? `\n\nContexto financiero actual del usuario logueado:\n${financialSummary}`
      : "";

    const generated = await generateStructured({
      schema: GeneralEducationSchema,
      system:
        `${SYSTEM_BASE}\n\n` +
        "Modo: educación y consejería financiera general adaptada. " +
        "Primero, debes iniciar presentándole brevemente al usuario el contexto de información financiera con el que cuentas " +
        "(sus ingresos, gastos y presupuestos actuales del mes si están disponibles en el contexto). " +
        "Luego, explica conceptos y consejos generales del tema solicitado, relacionándolos de manera suave y educativa " +
        "con sus datos del mes para que entienda cómo se aplican a su situación real. " +
        "Escribe en español neutro de Ecuador, con un tono cálido y empático.\n\n" +
        "Prohibido estrictamente: recomendar un instrumento financiero específico (como comprar una acción concreta o ir a un banco específico) o dar garantías de rendimiento. " +
        "Si los datos financieros muestran que no hay transacciones o presupuestos, menciónalo amablemente.",
      prompt: `Explicá de forma general y educativa el siguiente tema, relacionándolo de forma práctica con los datos del usuario si están disponibles:\n\nTema: "${topicText}"${contextPrompt}`,
    });
    return generated.answer?.trim() || null;
  } catch (error) {
    console.error("[support-flow] Error generating general education reply:", error);
    return null;
  }
}

/**
 * Consulta si el conversationId tiene una bifurcación pendiente sin
 * resolver — se llama antes de clasificar el mensaje, para que la
 * respuesta del usuario ("1", "el caso", "la recomendación") no se
 * reinterprete desde cero.
 */
export async function checkPendingSupportChoice(
  supabase: SupabaseClient,
  conversationId: string,
): Promise<string | null> {
  const { data, error } = await supabase
    .from("messages")
    .select("metadata")
    .eq("conversation_id", conversationId)
    .eq("role", "assistant")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error("[support-flow] Error checking pending support choice:", error);
    return null;
  }

  const metadata = data?.metadata as { support_choice_pending?: { pendingText?: string } } | null;
  const pendingText = metadata?.support_choice_pending?.pendingText;
  return typeof pendingText === "string" && pendingText.length > 0 ? pendingText : null;
}

async function createGeneralSupportTicket(
  input: OrchestratorInput,
  pendingText: string,
): Promise<OrchestratorResult> {
  const { supabase, userId, conversationId, text } = input;

  const { data: recentMessages, error: historyError } = await supabase
    .from("messages")
    .select("role, content, created_at")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: false })
    .limit(12);

  if (historyError) {
    console.error("[support-flow] Error reading conversation history:", historyError);
  }

  const summary = `Usuario pidió ayuda con: "${pendingText.slice(0, 240)}". No encontré una respuesta aprobada.`;

  const { data: ticket, error } = await supabase
    .from("tickets")
    .insert({
      user_id: userId,
      category: "general",
      priority: "medium",
      summary,
      context_json: {
        source: "chat",
        trigger: "no_approved_answer",
        original_question: pendingText,
        chosen_by_user: true,
      },
      conversation_json: (recentMessages || []).reverse(),
      status: "PENDING_HUMAN_REVIEW",
    })
    .select("id")
    .single();

  if (error || !ticket) {
    console.error("[support-flow] Error creating general ticket:", error);
    return { reply: "No pude crear el caso. Probemos de nuevo en un momento." };
  }

  const empathy = detectsDistress(text) ? "Entiendo. " : "";

  return {
    reply: `${empathy}Listo, abrí un caso (#${ticket.id.slice(0, 8)}) para que alguien de nuestro equipo te ayude con esto.`,
    ticket_id: ticket.id,
  };
}

async function buildRecommendationReply(
  input: OrchestratorInput,
  pendingText: string,
): Promise<OrchestratorResult> {
  const { supabase, userId } = input;

  let financialSummary = "";
  let snapshot: FinancialInsightSnapshot | null = null;
  try {
    snapshot = await loadFinancialInsightSnapshot({ supabase, userId });
    if (snapshot) {
      financialSummary = `Datos financieros del usuario logueado en este mes (${snapshot.month}):
- Ingresos actuales: USD ${snapshot.current.income}
- Gastos actuales: USD ${snapshot.current.expense}
- Balance neto: USD ${snapshot.current.net}
- Transacciones de gasto registradas: ${snapshot.current.transactionCount}
- Categorías de gasto: ${
        Object.entries(snapshot.current.byCategory)
          .map(([c, a]) => `${c}: USD ${a}`)
          .join(", ") || "Ninguna"
      }
- Presupuestos mensuales: ${snapshot.budgets.map((b: InsightBudget) => `${b.category} (límite USD ${b.limitAmount})`).join(", ") || "Ninguno"}`;
    }
  } catch (err) {
    console.error("[support-flow] Error loading snapshot for recommendation:", err);
  }

  const { data: kbRows, error: kbError } = await supabase
    .from("knowledge_articles")
    .select("id, title, content, category, version, source")
    .eq("approved", true);

  if (kbError) {
    console.error("[support-flow] Error reading approved KB for recommendation:", kbError);
  }

  const approvedArticles = (kbRows || []) as KnowledgeArticle[];
  const related = rankKnowledgeArticles(pendingText, approvedArticles, 2);

  let reply: string;

  if (looksLikeOwnStateQuestion(pendingText) && snapshot) {
    let personalized = "";
    try {
      personalized = await buildPersonalizedFinancialReply({
        supabase,
        userId,
        userText: pendingText,
        conversationId: input.conversationId,
      });
    } catch (error) {
      console.error("[support-flow] Error building personalized recommendation:", error);
    }
    reply =
      personalized ||
      `Actualmente tienes ingresos por USD ${snapshot.current.income} y gastos por USD ${snapshot.current.expense}.`;
  } else if (related.length > 0) {
    // Hay artículo aprobado sobre el tema: es la fuente preferida, siempre
    // por sobre generar algo desde cero.
    reply = buildGeneralGuidanceReply(related);
  } else {
    // Sin artículo de KB, pero el tema en sí no es un pedido de
    // recomendación específica (eso ya se filtró antes de llegar acá) —
    // damos una explicación educativa general real en vez de rendirnos.
    const generalEducation = await generateGeneralEducationReply(pendingText, financialSummary);
    reply = generalEducation
      ? `Esto es una pauta general basada en tu situación actual:\n\n${generalEducation}`
      : "Por ahora no tengo información específica sobre esto, así que prefiero no improvisar una respuesta.";
  }

  return {
    reply: `${reply}\n\n${CASE_NUDGE}`,
    citations: related.length
      ? related.map((article) => ({
          title: article.title,
          version: article.version,
          source: article.source,
        }))
      : undefined,
  };
}

/**
 * Resuelve la respuesta del usuario a una bifurcación pendiente. Si no se
 * entiende la elección, se vuelve a ofrecer sin perder la pregunta original.
 */
export async function resolveSupportChoice(
  input: OrchestratorInput,
  pendingText: string,
): Promise<OrchestratorResult> {
  const choice = parseSupportChoice(input.text);

  if (choice === "ticket") return createGeneralSupportTicket(input, pendingText);
  if (choice === "recommendation") return buildRecommendationReply(input, pendingText);

  return offerSupportChoice(
    pendingText,
    'No entendí tu elección. Respondé "1" para abrir un caso, o "2" para la recomendación general.',
  );
}

// =========================================================
// Flujo original de soporte — casos sensibles y pedidos de asesoría de
// inversión específica siguen yendo directo a ticket (sin preguntar),
// consistente con "ninguna acción sensible se ejecuta sola". Todo lo demás
// que antes terminaba en noApprovedAnswerReply() ahora ofrece la
// bifurcación.
// =========================================================

async function createHumanReviewTicket(
  input: OrchestratorInput,
  sensitivity: NonNullable<ReturnType<typeof classifySensitivity>>,
): Promise<OrchestratorResult> {
  const { text, supabase, userId, conversationId } = input;

  const { data: recentMessages, error: historyError } = await supabase
    .from("messages")
    .select("role, content, created_at")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: false })
    .limit(12);

  if (historyError) {
    console.error("[support-flow] Error reading conversation history:", historyError);
  }

  const summary =
    `Usuario reporta: "${text.slice(0, 240)}". ` + `Motivo detectado: ${sensitivity.reason}.`;

  const { data: existingTicket } = await supabase
    .from("tickets")
    .select("id")
    .eq("user_id", userId)
    .eq("category", sensitivity.category)
    .eq("summary", summary)
    .eq("status", "PENDING_HUMAN_REVIEW")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (existingTicket?.id) {
    return {
      reply:
        `Tu caso (#${existingTicket.id.slice(0, 8)}) ya está pendiente para que alguien de nuestro equipo lo revise. ` +
        "No ejecuté ninguna acción sensible automáticamente.",
      ticket_id: existingTicket.id,
    };
  }

  const { data: ticket, error } = await supabase
    .from("tickets")
    .insert({
      user_id: userId,
      category: sensitivity.category,
      priority: sensitivity.priority,
      summary,
      context_json: {
        source: "chat",
        channel: "web",
        trigger: sensitivity,
        requires_human_review: true,
        automation_executed: false,
      },
      conversation_json: (recentMessages || []).reverse(),
      status: "PENDING_HUMAN_REVIEW",
    })
    .select("id")
    .single();

  if (error || !ticket) {
    console.error("[support-flow] Error creating ticket:", error);
    return {
      reply: "No pude crear el caso. Reintenta en un momento.",
    };
  }

  const empathy = detectsDistress(text) ? "Entiendo, esto se ve importante. " : "";

  return {
    reply:
      `${empathy}Abrí un caso (#${ticket.id.slice(0, 8)}) para que alguien de nuestro equipo lo revise, con el historial y el contexto. ` +
      "Quedó pendiente de revisión humana; no ejecuté ninguna acción sensible.",
    ticket_id: ticket.id,
  };
}

export async function handleSupportFlow(input: OrchestratorInput): Promise<OrchestratorResult> {
  const { text, supabase } = input;
  const sensitivity = classifySensitivity(text);

  // Casos sensibles: siempre directo a ticket, nunca se le pregunta al
  // usuario si quiere una "recomendación" en su lugar.
  if (sensitivity) {
    return createHumanReviewTicket(input, sensitivity);
  }

  // Único caso vetado de verdad: pedir una recomendación de inversión
  // específica y personalizada. Nada de bifurcación acá — directo a caso.
  // Un interés general en el tema ("quiero invertir pero no sé por dónde
  // empezar") NO cae acá, sigue el flujo normal de abajo.
  if (requestsSpecificInvestmentAdvice(text)) {
    return createInvestmentAdviceTicket(input);
  }

  const { data, error } = await supabase
    .from("knowledge_articles")
    .select("id, title, content, category, version, source")
    .eq("approved", true);

  if (error) {
    console.error("[support-flow] Error reading approved KB:", error);
    return {
      reply: "No pude consultar la base aprobada en este momento. Intentemos nuevamente.",
    };
  }

  const approvedArticles = (data || []) as KnowledgeArticle[];
  const rankedArticles = rankKnowledgeArticles(text, approvedArticles, 3);

  if (rankedArticles.length === 0) {
    return offerSupportChoice(text);
  }

  try {
    const generated = await generateStructured({
      schema: SupportAnswerSchema,
      system: `${SYSTEM_BASE}\n\nRegla de seguridad adicional: responde únicamente con hechos explícitos de los artículos entregados. No completes vacíos, no supongas procedimientos y no recomiendes inversiones personalizadas.`,
      prompt: `Pregunta del cliente:
${text}

Artículos aprobados recuperados:
${rankedArticles
  .map(
    (article) =>
      `ID: ${article.id}\nTítulo: ${article.title}\nCategoría: ${article.category}\nVersión: ${article.version}\nFuente: ${article.source}\nContenido: ${article.content}`,
  )
  .join("\n\n---\n\n")}

Devuelve:
- can_answer=true solo cuando la respuesta esté explícitamente respaldada.
- answer breve y clara en español de Ecuador, o null.
- used_article_ids únicamente con los ID realmente utilizados.
- missing_reason con lo que falta cuando no sea posible responder, o null.

No cites artículos que no hayas usado.`,
    });

    const grounded = validateGroundedSupportAnswer(generated, rankedArticles);

    if (!grounded) {
      return offerSupportChoice(text);
    }

    return {
      reply: `${grounded.answer}\n\n${CASE_NUDGE}`,
      citations: grounded.usedArticles.map((article) => ({
        title: article.title,
        version: article.version,
        source: article.source,
      })),
    };
  } catch (generationError) {
    console.error("[support-flow] Error generating grounded answer:", generationError);
    return offerSupportChoice(text);
  }
}

export function validateGroundedSupportAnswer(
  answer: SupportAnswer,
  articles: KnowledgeArticle[],
): {
  answer: string;
  usedArticles: KnowledgeArticle[];
} | null {
  if (!answer.can_answer || !answer.answer?.trim()) {
    return null;
  }

  const articlesById = new Map(articles.map((article) => [article.id, article]));
  const uniqueIds = [...new Set(answer.used_article_ids)];
  const usedArticles = uniqueIds
    .map((id) => articlesById.get(id))
    .filter((article): article is KnowledgeArticle => Boolean(article));

  if (usedArticles.length === 0 || usedArticles.length !== uniqueIds.length) {
    return null;
  }

  return {
    answer: answer.answer.trim(),
    usedArticles,
  };
}
