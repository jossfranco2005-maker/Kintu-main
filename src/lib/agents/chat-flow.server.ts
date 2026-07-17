import { completeExpenseFlow, reviseExpenseFlow } from "@/lib/agents/expense-flow";
import { decideDraftTurn } from "@/lib/agents/draft-turn-decision.server";
import { isDraftCorrectionMessage } from "@/lib/agents/message-understanding";
import {
  cancelTransactionDraft,
  createTransactionDraft,
  findActiveTransactionDraft,
  updateTransactionDraft,
} from "@/lib/agents/transaction-drafts.server";
import { loadUserBudgetCategories } from "@/lib/finance/user-category.server";
import {
  runOrchestrator,
  type OrchestratorInput,
  type OrchestratorResult,
} from "@/lib/agents/orchestrator-with-notifications";

export type ChatFlowResult = OrchestratorResult & {
  draft_id?: string;
  cancelled_draft_id?: string;
};

/**
 * Punto central del chat.
 *
 * Antes de iniciar una intención nueva, comprueba si existe
 * una transacción pendiente en esta conversación.
 */
export async function processChatMessage(input: OrchestratorInput): Promise<ChatFlowResult> {
  const { supabase, userId, conversationId, text } = input;

  let activeDraft = null;
  let userCategories = new Set<string>();

  try {
    userCategories = await loadUserBudgetCategories({ supabase, userId });
  } catch (error) {
    console.error("[chat-flow] Error loading user categories:", error);
  }

  try {
    activeDraft = await findActiveTransactionDraft(supabase, userId, conversationId);
  } catch (error) {
    console.error("[chat-flow] Error reading active draft:", error);
  }

  if (activeDraft) {
    let history: Array<{ role: string; content: string }> = [];
    try {
      const { data } = await supabase
        .from("messages")
        .select("role, content, created_at")
        .eq("conversation_id", conversationId)
        .order("created_at", { ascending: false })
        .limit(8);
      history = (data ?? [])
        .slice(1)
        .reverse()
        .map((message) => ({ role: message.role, content: message.content }));
    } catch (error) {
      console.error("[chat-flow] Error reading draft context:", error);
    }

    const decision = await decideDraftTurn({ text, draft: activeDraft, history });

    if (decision.action === "cancel_draft") {
      await cancelTransactionDraft(supabase, {
        id: activeDraft.id,
        userId,
      });

      return {
        reply: "Listo, descarté la transacción pendiente.",
        cancelled_draft_id: activeDraft.id,
      };
    }

    if (
      decision.action === "support_or_sensitive" ||
      decision.action === "financial_query" ||
      decision.action === "general_question"
    ) {
      const supportResult = await runOrchestrator(input);

      return {
        ...supportResult,
        reply:
          supportResult.reply +
          "\n\nTu transacción pendiente sigue guardada. " +
          "Puedes retomarla después o escribir “cancelar” para descartarla.",
      };
    }

    if (decision.action === "new_transaction") {
      return {
        reply:
          "Detecté una transacción nueva y no la mezclé con la pendiente. " +
          "Descarta primero el borrador anterior si quieres comenzar la nueva; el borrador actual sigue guardado.",
        draft: { ...activeDraft, needs: activeDraft.needs },
        draft_id: activeDraft.id,
      };
    }

    if (decision.action === "replace_draft" && decision.currentRequestText?.trim()) {
      await cancelTransactionDraft(supabase, { id: activeDraft.id, userId });
      const replacement = await processChatMessage({
        ...input,
        text: decision.currentRequestText.trim(),
      });
      return { ...replacement, cancelled_draft_id: activeDraft.id };
    }

    if (decision.action === "ambiguous") {
      return {
        reply:
          "No quiero mezclar ese mensaje con la transacción pendiente. " +
          "¿Deseas completar el borrador, corregirlo, descartarlo o hacer otra consulta?",
        draft: { ...activeDraft, needs: activeDraft.needs },
        draft_id: activeDraft.id,
      };
    }

    if (decision.action === "confirm_draft") {
      return {
        reply:
          activeDraft.status === "AWAITING_CONFIRMATION"
            ? "La transacción está lista. Usa el botón Confirmar para guardarla de forma segura."
            : "Todavía faltan datos antes de poder confirmar la transacción.",
        draft: { ...activeDraft, needs: activeDraft.needs },
        draft_id: activeDraft.id,
      };
    }

    if (decision.action === "correct_draft" || isDraftCorrectionMessage(text)) {
      const revised = await reviseExpenseFlow({
        text,
        userCategories,
        currentDraft: {
          type: activeDraft.type,
          amount: activeDraft.amount,
          currency: activeDraft.currency,
          date: activeDraft.date,
          category: activeDraft.category,
          merchant: activeDraft.merchant,
          description: activeDraft.description,
        },
      });

      if (!revised.draft) {
        return revised;
      }

      const updated = await updateTransactionDraft(supabase, {
        id: activeDraft.id,
        userId,
        draft: revised.draft,
        needs: revised.draft.needs,
      });

      return {
        ...revised,
        draft_id: updated.id,
      };
    }

    if (activeDraft.status === "NEEDS_INFO") {
      const completed = await completeExpenseFlow({
        text,
        userCategories,
        history,
        currentDraft: {
          type: activeDraft.type,
          amount: activeDraft.amount,
          currency: activeDraft.currency,
          date: activeDraft.date,
          category: activeDraft.category,
          merchant: activeDraft.merchant,
          description: activeDraft.description,
        },
      });

      if (!completed.draft) {
        return completed;
      }

      const updated = await updateTransactionDraft(supabase, {
        id: activeDraft.id,
        userId,
        draft: completed.draft,
        needs: completed.draft.needs,
      });

      return {
        ...completed,
        draft_id: updated.id,
      };
    }

    if (activeDraft.status === "AWAITING_CONFIRMATION") {
      return {
        reply:
          "Ya tienes una transacción lista. " + "Confírmala o descártala antes de iniciar otra.",

        draft: {
          type: activeDraft.type,
          amount: activeDraft.amount,
          currency: activeDraft.currency,
          date: activeDraft.date,
          category: activeDraft.category,
          merchant: activeDraft.merchant,
          description: activeDraft.description,
          needs: [],
        },

        draft_id: activeDraft.id,
      };
    }
  }

  const result = await runOrchestrator(input);

  if (!result.draft) {
    return result;
  }

  try {
    const stored = await createTransactionDraft(supabase, {
      userId,
      conversationId,
      draft: result.draft,
      needs: result.draft.needs,
    });

    return {
      ...result,
      draft_id: stored.id,
    };
  } catch (error) {
    console.error("[chat-flow] Error creating draft:", error);

    return {
      ...result,
      reply:
        result.reply + "\n\nNo pude conservar el borrador. " + "Intenta nuevamente en un momento.",
    };
  }
}
