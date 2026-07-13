import { generateStructured } from "@/lib/ai/structured.server";
import {
  analyzeMessageWithRules,
  fallbackUnderstanding,
  type MessageUnderstanding,
} from "@/lib/agents/message-understanding";
import { MessageUnderstandingSchema, SYSTEM_BASE } from "@/lib/agents/schemas";

function clampConfidence(value: number): number {
  return Math.min(1, Math.max(0, value));
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
  if (rules.intent === "support" || rules.intent === "cancel") {
    return rules;
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
    confidence: clampConfidence(conflict ? Math.min(llm.confidence, 0.58) : llm.confidence),
    source: "llm",
  };
}

export async function understandMessage(
  text: string,
  history?: Array<{ role: string; content: string }>,
): Promise<MessageUnderstanding> {
  const rules = analyzeMessageWithRules(text);

  // Casos claros y críticos se resuelven por reglas para ganar seguridad y velocidad.
  if (rules && rules.confidence >= 0.95) {
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

No confundas hablar sobre dinero con ordenar o reportar una transacción.

Mensaje actual del usuario a analizar: ${text}`,
    });

    return mergeWithRuleSafety(output, rules);
  } catch (error) {
    console.error("[message-understanding] Error analyzing message:", error);
    return rules ?? fallbackUnderstanding();
  }
}
