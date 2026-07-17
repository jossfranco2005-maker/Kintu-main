import { generateStructured } from "@/lib/ai/structured.server";
import {
  analyzeMessageWithRules,
  fallbackUnderstanding,
  normalizeUnderstandingText,
  type MessageUnderstanding,
} from "@/lib/agents/message-understanding";
import { MessageUnderstandingSchema, SYSTEM_BASE } from "@/lib/agents/schemas";
import {
  classifySensitivity,
  requestsPersonalizedInvestmentAdvice,
} from "@/lib/finance/sensitivity";

function clampConfidence(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function sanitizeCurrentRequest<
  T extends { dismissPendingState?: boolean; currentRequestText?: string | null },
>(value: T, originalText: string): T {
  if (!value.dismissPendingState || !value.currentRequestText?.trim()) return value;
  const original = normalizeUnderstandingText(originalText).replace(/[.!?;]+/g, " ");
  const current = normalizeUnderstandingText(value.currentRequestText).replace(/[.!?;]+/g, " ");
  if (original.includes(current.trim())) return value;
  return { ...value, dismissPendingState: false, currentRequestText: null };
}

function mergeWithRuleSafety(
  llm: Omit<MessageUnderstanding, "source">,
  rules: MessageUnderstanding | null,
): MessageUnderstanding {
  if (!rules) {
    return {
      ...llm,
      confidence: clampConfidence(llm.confidence),
      source: "llm",
    };
  }

  // Las decisiones sensibles y de cancelación nunca quedan subordinadas al modelo.
  if (rules.intent === "cancel") {
    return rules;
  }

  if ((llm.intent === "unknown" || llm.confidence < 0.6) && rules.confidence >= 0.9) {
    return {
      ...rules,
      negated: rules.negated || llm.negated,
      future: rules.future || llm.future,
      hypothetical: rules.hypothetical || llm.hypothetical,
      multipleOperations: rules.multipleOperations || llm.multipleOperations,
      budgetAction: rules.budgetAction ?? llm.budgetAction,
      dismissPendingState: llm.dismissPendingState,
      currentRequestText: llm.currentRequestText,
    };
  }

  const conflict =
    rules.intent !== "unknown" && llm.intent !== "unknown" && rules.intent !== llm.intent;

  return {
    intent: rules.intent === "correction" ? "correction" : llm.intent,
    transactionType: llm.transactionType ?? rules.transactionType,
    speechAct: rules.correction ? "correction" : llm.speechAct,
    occurred: rules.negated || rules.future || rules.hypothetical ? false : llm.occurred,
    negated: rules.negated || llm.negated,
    future: rules.future || llm.future,
    hypothetical: rules.hypothetical || llm.hypothetical,
    correction: rules.correction || llm.correction,
    multipleOperations: rules.multipleOperations || llm.multipleOperations,
    budgetAction: llm.budgetAction,
    dismissPendingState: llm.dismissPendingState,
    currentRequestText: llm.currentRequestText,
    confidence: clampConfidence(conflict ? Math.min(llm.confidence, 0.58) : llm.confidence),
    source: "llm",
  };
}

export async function understandMessage(
  text: string,
  history?: Array<{ role: string; content: string }>,
): Promise<MessageUnderstanding> {
  const rules = analyzeMessageWithRules(text);

  // Solo controles explícitos y seguridad evitan la comprensión contextual.
  // Las demás intenciones, aunque parezcan claras por reglas, pasan por la
  // salida estructurada para no convertir el sistema en un clasificador rígido.
  if (
    rules &&
    (rules.intent === "cancel" ||
      classifySensitivity(text) ||
      requestsPersonalizedInvestmentAdvice(text))
  ) {
    return rules;
  }

  try {
    let historyPrompt = "";
    if (history && history.length > 0) {
      historyPrompt =
        `Historial reciente de la conversación (de más antiguo a más reciente):\n` +
        history
          .map((m) => `${m.role === "user" ? "Usuario" : "Asistente"}: ${m.content}`)
          .join("\n") +
        "\n\n";
    }

    const output = await generateStructured({
      name: "message-understanding",
      schema: MessageUnderstandingSchema,
      system: SYSTEM_BASE,
      prompt: `${historyPrompt}Analiza la intención real del mensaje del usuario.

Devuelve:
- intent: transaction, budget, support, summary, smalltalk, cancel, correction o unknown.
- transactionType: income, expense o null.
- speechAct: report, question, command, complaint, correction, hypothetical, cancel o unknown.
- occurred: true solo cuando la transacción ya ocurrió; false cuando fue negada, futura, hipotética o solo una pregunta; null si no aplica.
- negated, future, hypothetical, correction y multipleOperations.
- confidence: número entre 0 y 1 según la claridad del mensaje.
- budgetAction: create_or_update solo si pide crear, configurar o modificar un presupuesto; query si pide consultar o explicar; none si no aplica.
- dismissPendingState: true cuando descarta una opción, caso, borrador o tema anterior y formula una solicitud nueva vigente.
- currentRequestText: cuando el mensaje es compuesto, devuelve solamente la solicitud nueva vigente sin reescribirla; null en los demás casos.

Reglas esenciales:
- "Gané 100" = transaction/income/report/occurred=true.
- "Me cayó una platita de 80" = transaction/income/report/occurred=true.
- "No gasté 20" = transaction/expense/negated=true/occurred=false.
- "Ojalá ganara 100" = transaction/income/hypothetical=true/occurred=false.
- "Mañana me pagan 100" = transaction/income/future=true/occurred=false.
- "¿Cómo registro un ingreso?" = support/question, no transacción.
- "No fueron 30, fueron 20" = correction.
- "Me cobraron dos veces" = support/complaint.
- "Gasté 10 en taxi y 25 en comida" = transaction/expense/multipleOperations=true.
- "Fueron 100" = unknown o transaction con confianza baja.
- Si el mensaje es una pregunta de seguimiento (ej. "¿y la segunda?", "¿pero en qué?", "¿cuál fue la mayor?", "¿y los ingresos?", "¿y en cuál?") y el historial muestra que se estaba hablando de resúmenes, gastos o ingresos, clasifícala como "summary".
- Si el mensaje es una pregunta de seguimiento sobre límites o presupuestos, clasifícala como "budget".
- "No quiero ninguna opción. Registra un gasto de 5 dólares en Uber" descarta el estado anterior y la solicitud vigente es registrar el gasto.
- Una emoción aislada sin incidente ni solicitud humana necesita empatía y contexto; no implica un incidente sensible.
- Si una frase nominal como "Compra de 20 dólares el 20 de julio" no aclara si ya ocurrió o está planificada, usa occurred=false y confianza baja para pedir aclaración.
- Si usa lenguaje futuro, future=true. Si usa lenguaje pasado con una fecha futura, conserva occurred=true para que la validación determinista de fecha señale la contradicción.

No confundas hablar sobre dinero con ordenar o reportar una transacción.

Mensaje actual del usuario a analizar: ${text}`,
    });

    return sanitizeCurrentRequest(mergeWithRuleSafety(output, rules), text);
  } catch (error) {
    console.error("[message-understanding] Error analyzing message:", error);
    return rules ?? fallbackUnderstanding();
  }
}
