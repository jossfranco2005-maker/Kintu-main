import { completeExpenseFlow, reviseExpenseFlow } from "@/lib/agents/expense-flow";
import { shouldInterruptTransactionDraft } from "@/lib/agents/draft-interruption";
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

function isCancellationMessage(text: string, awaitingConfirmation: boolean): boolean {
  if (
    /^\s*(?:no\s*,?\s*)?(?:cancelar|cancela(?:lo|la)?|descartar|descarta(?:lo|la)?|olvídalo|olvidalo|déjalo|dejalo)\s*[.!]?\s*$/i.test(
      text,
    )
  ) {
    return true;
  }

  return awaitingConfirmation && /^\s*no\s*[.!]?\s*$/i.test(text);
}

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
    if (isCancellationMessage(text, activeDraft.status === "AWAITING_CONFIRMATION")) {
      await cancelTransactionDraft(supabase, {
        id: activeDraft.id,
        userId,
      });

      return {
        reply: "Listo, descarté la transacción pendiente.",
        cancelled_draft_id: activeDraft.id,
      };
    }

    if (shouldInterruptTransactionDraft(text)) {
      const supportResult = await runOrchestrator(input);

      return {
        ...supportResult,
        reply:
          supportResult.reply +
          "\n\nTu transacción pendiente sigue guardada. " +
          "Puedes retomarla después o escribir “cancelar” para descartarla.",
      };
    }

    if (isDraftCorrectionMessage(text)) {
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
