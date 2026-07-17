import { z } from "zod";

import type { StoredTransactionDraft } from "@/lib/agents/transaction-drafts.server";
import { generateStructured } from "@/lib/ai/structured.server";
import { SYSTEM_BASE } from "@/lib/agents/schemas";
import { shouldInterruptTransactionDraft } from "@/lib/agents/draft-interruption";
import {
  isDraftCorrectionMessage,
  isExplicitCancellationMessage,
  normalizeUnderstandingText,
} from "@/lib/agents/message-understanding";

export const DraftTurnDecisionSchema = z.object({
  action: z.enum([
    "continue_draft",
    "correct_draft",
    "confirm_draft",
    "cancel_draft",
    "financial_query",
    "support_or_sensitive",
    "new_transaction",
    "replace_draft",
    "general_question",
    "ambiguous",
  ]),
  confidence: z.number().min(0).max(1),
  reason: z.string().max(240),
  currentRequestText: z.string().nullable(),
});

export type DraftTurnDecision = z.infer<typeof DraftTurnDecisionSchema>;

function isExplicitConfirmation(text: string): boolean {
  return /^(?:s[ií][,.]?\s*)?(?:confirma(?:r)?|guarda(?:r)?)(?:\s+(?:ese|esa|el|la)?\s*(?:gasto|ingreso|transacci[oó]n|movimiento))?\s*[.!]?$/i.test(
    text.trim(),
  );
}

function safeFallbackDecision(text: string): DraftTurnDecision {
  if (isDraftCorrectionMessage(text)) {
    return {
      action: "correct_draft",
      confidence: 0.9,
      reason: "Corrección explícita",
      currentRequestText: null,
    };
  }
  // Una respuesta corta es compatible con completar un campo. Ante una
  // frase compleja desconocida no se arriesga a contaminar el borrador.
  const words = normalizeUnderstandingText(text).split(/\s+/).filter(Boolean);
  return words.length <= 5
    ? {
        action: "continue_draft",
        confidence: 0.55,
        reason: "Respuesta breve compatible",
        currentRequestText: null,
      }
    : {
        action: "ambiguous",
        confidence: 0.3,
        reason: "No fue posible decidir con seguridad",
        currentRequestText: null,
      };
}

export async function decideDraftTurn(params: {
  text: string;
  draft: StoredTransactionDraft;
  history: Array<{ role: string; content: string }>;
}): Promise<DraftTurnDecision> {
  const { text, draft, history } = params;

  // Overrides limitados a controles y seguridad. El resto se decide con una
  // única salida estructurada y contextual.
  if (shouldInterruptTransactionDraft(text)) {
    return {
      action: "support_or_sensitive",
      confidence: 1,
      reason: "Override de seguridad",
      currentRequestText: null,
    };
  }
  if (isExplicitCancellationMessage(text)) {
    return {
      action: "cancel_draft",
      confidence: 1,
      reason: "Cancelación explícita",
      currentRequestText: null,
    };
  }
  if (isExplicitConfirmation(text)) {
    return {
      action: "confirm_draft",
      confidence: 1,
      reason: "Confirmación explícita",
      currentRequestText: null,
    };
  }

  try {
    const decision = await generateStructured({
      name: "draft-turn-decision",
      schema: DraftTurnDecisionSchema,
      system: SYSTEM_BASE,
      prompt: `Decide cómo enrutar el turno actual cuando existe una transacción pendiente.

BORRADOR ACTUAL:
${JSON.stringify(draft, null, 2)}

CAMPOS FALTANTES: ${JSON.stringify(draft.needs)}
ESTADO: ${draft.status}

HISTORIAL RECIENTE:
${history.map((message) => `${message.role}: ${message.content}`).join("\n") || "(vacío)"}

MENSAJE ACTUAL:
${text}

Elige exactamente una acción:
- continue_draft: aporta uno o varios campos al borrador actual.
- correct_draft: cambia campos ya dados del borrador actual.
- confirm_draft o cancel_draft: controla el borrador.
- financial_query: pregunta por cifras, presupuestos, movimientos o una explicación financiera.
- support_or_sensitive: soporte institucional, reclamo o situación sensible.
- new_transaction: reporta otro movimiento distinto; nunca lo mezcles con el borrador.
- replace_draft: cancela explícitamente el borrador anterior y formula una nueva transacción vigente. currentRequestText contiene solo la nueva solicitud.
- general_question: pregunta de uso o conversación general.
- ambiguous: no hay evidencia suficiente.

Considera significado y contexto, no coincidencias de palabras. Una frase como "el comercio del gasto pendiente fue KFC" continúa el borrador; una transacción completa con otro monto es nueva. Una pregunta financiera pausa el borrador sin modificarlo. No dividas mecánicamente por puntuación: identifica la instrucción vigente.`,
    });
    if (decision.action === "replace_draft" && decision.currentRequestText) {
      const original = normalizeUnderstandingText(text).replace(/[.!?;]+/g, " ");
      const current = normalizeUnderstandingText(decision.currentRequestText).replace(
        /[.!?;]+/g,
        " ",
      );
      if (!original.includes(current.trim())) {
        return {
          action: "ambiguous",
          confidence: 0.3,
          reason: "La solicitud de reemplazo no coincide con el mensaje original",
          currentRequestText: null,
        };
      }
    }
    return decision;
  } catch (error) {
    console.error("[draft-turn-decision] Error deciding draft turn:", error);
    return safeFallbackDecision(text);
  }
}
