// Orchestrator — server-only logic. UI-agnostic.
// Input:  { text, userId, supabase (RLS-scoped), conversationId }
// Output: { reply, draft?, ticket_id?, alert? }
import { generateText } from "ai";
import type { SupabaseClient } from "@supabase/supabase-js";

import { handleExpenseFlow } from "@/lib/agents/expense-flow";
import {
  checkPendingSupportChoice,
  handleSupportFlow,
  resolveSupportChoice,
  isCompatibleSupportChoice,
} from "@/lib/agents/support-flow.server";
import {
  buildHypotheticalBudgetReply,
  buildPersonalizedFinancialReply,
} from "@/lib/agents/insight-agent.server";
import {
  BudgetIntentSchema,
  SYSTEM_BASE,
  type ExpenseDraft,
  type MissingExpenseField,
} from "@/lib/agents/schemas";
import {
  decideUnderstandingAction,
  isTransactionUsageQuestion,
  isExplicitConfirmationMessage,
  hasExplicitBudgetMutationAction,
  type UnderstandingAction,
} from "@/lib/agents/message-understanding";
import { understandMessage } from "@/lib/agents/message-understanding.server";
import {
  findTransactionDraftById,
  markTransactionDraftSaved,
} from "@/lib/agents/transaction-drafts.server";
import { withGroqKeyFailover } from "@/lib/ai/gateway.server";
import { generateStructured } from "@/lib/ai/structured.server";
import { firstOfMonth } from "@/lib/finance/budget";
import { formatMoney, normalizeCategory } from "@/lib/finance/categorize";
import { syncBudgetCurrentState, syncBudgetEffects } from "@/lib/finance/movement-effects.server";
import {
  detectUserBudgetCategory,
  loadUserBudgetCategories,
  normalizeNewUserCategory,
  resolveUserCategory,
} from "@/lib/finance/user-category.server";
import { createTransactionNotification } from "@/lib/notifications/transaction.server";

export type OrchestratorInput = {
  text: string;
  userId: string;
  supabase: SupabaseClient;
  conversationId: string;
};

export type OrchestratorResult = {
  reply: string;
  draft?: ExpenseDraft & { needs: MissingExpenseField[] };
  ticket_id?: string;
  alert?: { message: string; level: "threshold" | "exceeded" };
  citations?: Array<{ title: string; version: number; source: string }>;
  // Cuando el agente de soporte no puede responder con certeza, ofrece
  // elegir entre abrir un caso o recibir una recomendación general. Este
  // campo viaja hasta chat.functions.ts/webhook.ts, que deben guardarlo en
  // el metadata del mensaje del asistente para que el próximo turno de
  // esta conversación sepa que está resolviendo esa elección (ver
  // checkPendingSupportChoice en support-flow.server.ts).
  supportChoicePending?: { pendingText: string };
};

export type ConfirmedDraftSnapshot = {
  type: "income" | "expense";
  amount: number;
  date: string;
  category: string;
  merchant: string;
  description: string | null;
};

export type SaveConfirmedTransactionResult = {
  transactionId: string;
  alreadySaved: boolean;
  draft: ConfirmedDraftSnapshot;
  alert?: {
    message: string;
    level: "threshold" | "exceeded";
    alertId: string;
  };
};

const MAX_STEPS = 8;
const TRANSACTION_CLARIFICATION_REPLY =
  "No estoy completamente seguro de lo que deseas hacer. ¿Quieres registrar un ingreso, un gasto, crear un presupuesto o pedir ayuda?";

function recoverImmediateClarifiedRequest(params: {
  currentText: string;
  history: Array<{ role: string; content: string }>;
  intent: string;
  transactionType: "income" | "expense" | null;
}): string | null {
  const { currentText, history, intent, transactionType } = params;
  if (currentText.trim().split(/\s+/).length > 8) return null;
  if (intent !== "transaction" || !transactionType) return null;

  let lastAssistantIndex = -1;
  for (let index = history.length - 1; index >= 0; index -= 1) {
    if (history[index]?.role === "assistant") {
      lastAssistantIndex = index;
      break;
    }
  }
  if (
    lastAssistantIndex < 1 ||
    history[lastAssistantIndex]?.content !== TRANSACTION_CLARIFICATION_REPLY
  ) {
    return null;
  }
  let previousUser: { role: string; content: string } | undefined;
  for (let index = lastAssistantIndex - 1; index >= 0; index -= 1) {
    const message = history[index];
    if (message?.role === "user" && message.content.trim()) {
      previousUser = message;
      break;
    }
  }
  if (!previousUser) return null;

  return `${previousUser.content.trim()}\nAclaración inmediata del usuario: ${currentText.trim()}`;
}

async function handleBudget(input: OrchestratorInput): Promise<OrchestratorResult> {
  const { text, supabase, userId } = input;

  try {
    const output = await generateStructured({
      name: "budget-intent",
      schema: BudgetIntentSchema,
      system: SYSTEM_BASE,
      prompt: `Extrae un presupuesto mensual:
- category: una categoría
- limit_amount: monto positivo en USD
- alert_threshold: número entre 0 y 1; usa 0.80 si no se especifica

Mensaje: ${text}`,
    });

    if (!output.category && !output.limit_amount) {
      return { reply: "¿Para qué categoría y por qué monto quieres configurar el presupuesto?" };
    }
    if (!output.category) {
      return { reply: "¿Para qué categoría quieres configurar ese presupuesto?" };
    }
    if (!output.limit_amount) {
      return { reply: `¿Cuál debe ser el monto mensual del presupuesto de ${output.category}?` };
    }

    const userCategories = await loadUserBudgetCategories({ supabase, userId });
    const category =
      detectUserBudgetCategory(output.category, userCategories) ??
      normalizeNewUserCategory(output.category) ??
      normalizeCategory(output.category);
    const threshold = Math.min(1, Math.max(0.1, output.alert_threshold || 0.8));
    const limit = Math.max(1, output.limit_amount);
    const month = firstOfMonth();
    const { data: budget, error } = await supabase
      .from("budgets")
      .upsert(
        {
          user_id: userId,
          category,
          month,
          limit_amount: limit,
          alert_threshold: threshold,
        },
        { onConflict: "user_id,category,month" },
      )
      .select("id")
      .single();

    if (error || !budget) throw error || new Error("No se pudo guardar el presupuesto.");

    const [createdAlert] = await syncBudgetCurrentState({
      supabase,
      userId,
      budgetId: budget.id,
    });
    const baseReply = `Listo, presupuesto de ${category}: ${formatMoney(limit)} al mes, te aviso al ${Math.round(threshold * 100)}%.`;

    return {
      reply: createdAlert ? `${baseReply} ${createdAlert.message}` : baseReply,
      alert: createdAlert
        ? { message: createdAlert.message, level: createdAlert.level }
        : undefined,
    };
  } catch (error) {
    console.error("[orchestrator] Error creating budget:", error);
    return {
      reply: "No pude leer el presupuesto. Probá: 'presupuesto de 200 en comida, aviso al 80%'.",
    };
  }
}

async function handleSummary(input: OrchestratorInput): Promise<OrchestratorResult> {
  try {
    const reply = await buildPersonalizedFinancialReply({
      supabase: input.supabase,
      userId: input.userId,
      userText: input.text,
      conversationId: input.conversationId,
    });

    return { reply };
  } catch (error) {
    console.error("[orchestrator] Error building personalized summary:", error);
    return {
      reply:
        "No pude analizar tu información en este momento. Puedes revisar el dashboard o volver a pedirme el resumen.",
    };
  }
}

export function identityReplyForMessage(text: string): string | null {
  if (!/^\s*[¿]?\s*(?:qu[eé]\s+eres|qu[eé]\s+es\s+kintu)\s*[?]?\s*$/i.test(text)) return null;
  return "Soy Kintu, un asistente financiero que te ayuda a registrar movimientos, revisar presupuestos y resolver consultas.";
}

async function handleSmalltalk(input: OrchestratorInput): Promise<OrchestratorResult> {
  const identityReply = identityReplyForMessage(input.text);
  if (identityReply) return { reply: identityReply };
  try {
    const { text: reply } = await withGroqKeyFailover((model) =>
      generateText({
        model,
        maxRetries: 0,
        system: SYSTEM_BASE,
        prompt: `Responde en 1 o 2 frases, de forma cálida y breve. No repitas un saludo ni una presentación si la conversación ya comenzó. Describe solamente capacidades reales: registrar movimientos con confirmación, revisar presupuestos y consultas, o abrir un caso cuando corresponda.\n\nMensaje: ${input.text}`,
      }),
    );
    return { reply };
  } catch (error) {
    console.error("[orchestrator] Error in smalltalk:", error);
    return {
      reply:
        "Estoy acá. Puedo anotar un gasto, revisar tu presupuesto o abrir un caso con un humano.",
    };
  }
}

export async function runOrchestrator(
  input: OrchestratorInput,
  stepsUsed = 0,
): Promise<OrchestratorResult> {
  if (stepsUsed >= MAX_STEPS) {
    return { reply: "Se hizo largo el análisis. Probemos con un mensaje más corto." };
  }

  if (isExplicitConfirmationMessage(input.text)) {
    return {
      reply:
        "No existe una transacción pendiente para confirmar. Si acabas de guardarla, la anterior ya quedó registrada y no la duplicaré.",
    };
  }

  // Si el turno anterior dejó una bifurcación pendiente (¿caso o
  // recomendación?), este mensaje la resuelve — no pasa por el
  // clasificador general, porque "1" o "la recomendación" no tienen
  // intención propia fuera de ese contexto.
  const pendingSupportText = await checkPendingSupportChoice(input.supabase, input.conversationId);
  if (pendingSupportText && isCompatibleSupportChoice(input.text)) {
    return resolveSupportChoice(input, pendingSupportText);
  }

  let recentMessages: Array<{ role: string; content: string }> = [];
  try {
    const { data: dbMessages } = await input.supabase
      .from("messages")
      .select("role, content, created_at")
      .eq("conversation_id", input.conversationId)
      .order("created_at", { ascending: true });

    if (dbMessages) {
      const historyOnly = dbMessages.slice(0, -1);
      recentMessages = historyOnly
        .map((m) => ({
          role: m.role,
          content: m.content,
        }))
        .slice(-6);
    }
  } catch (err) {
    console.error("[orchestrator] Error loading recent messages:", err);
  }

  let understanding = await understandMessage(input.text, recentMessages);
  const recoveredRequest = recoverImmediateClarifiedRequest({
    currentText: input.text,
    history: recentMessages,
    intent: understanding.intent,
    transactionType: understanding.transactionType,
  });
  if (recoveredRequest) {
    understanding = await understandMessage(recoveredRequest, recentMessages);
  }
  const effectiveText =
    understanding.dismissPendingState && understanding.currentRequestText?.trim()
      ? understanding.currentRequestText.trim()
      : (recoveredRequest ?? input.text);
  const effectiveInput = effectiveText === input.text ? input : { ...input, text: effectiveText };
  const action: UnderstandingAction = decideUnderstandingAction(understanding);

  switch (action) {
    case "ignore_negated":
      return {
        reply: "Entendí que esa transacción no ocurrió, así que no registraré nada.",
      };
    case "ignore_future":
      return {
        reply:
          "Parece un movimiento futuro. Para evitar registrarlo antes de tiempo, anótalo cuando ya haya ocurrido.",
      };
    case "ignore_hypothetical":
      return {
        reply:
          "Parece un ejemplo o una posibilidad, no una transacción realizada. No registraré nada.",
      };
    case "simulate_hypothetical":
      return {
        reply: await buildHypotheticalBudgetReply({
          supabase: input.supabase,
          userId: input.userId,
          userText: effectiveText,
        }),
      };
    case "split_multiple":
      return {
        reply:
          "Detecté más de un movimiento. Para evitar errores, envíalos uno por uno; primero indícame solo el primero.",
      };
    case "cancel":
      return {
        reply: "No tienes una transacción pendiente para descartar en esta conversación.",
      };
    case "correction_without_draft":
      return {
        reply:
          "No hay un borrador pendiente para corregir. Envíame la transacción completa y la prepararé.",
      };
    case "clarify":
      return {
        reply: TRANSACTION_CLARIFICATION_REPLY,
      };
    default:
      break;
  }

  switch (understanding.intent) {
    case "transaction": {
      let userCategories = new Set<string>();
      try {
        userCategories = await loadUserBudgetCategories({
          supabase: input.supabase,
          userId: input.userId,
        });
      } catch (error) {
        console.error("[orchestrator] No se pudieron cargar categorías personalizadas:", error);
      }

      return handleExpenseFlow({
        text: effectiveText,
        transactionType: understanding.transactionType,
        userCategories,
      });
    }
    case "budget":
      if (
        understanding.budgetAction !== "create_or_update" &&
        !hasExplicitBudgetMutationAction(effectiveText)
      ) {
        return handleSummary(effectiveInput);
      }
      return handleBudget(effectiveInput);
    case "summary":
      return handleSummary(effectiveInput);
    case "support":
      if (isTransactionUsageQuestion(effectiveText)) {
        return {
          reply:
            "Escríbeme algo como: “Hoy gasté 25 dólares en comida en KFC”. " +
            "Te mostraré un borrador para que lo confirmes antes de guardarlo.",
        };
      }
      return handleSupportFlow(effectiveInput);
    case "smalltalk":
      return handleSmalltalk(input);
    default:
      return {
        reply:
          "No logré identificar la intención. Puedes pedirme registrar un ingreso o gasto, revisar tu resumen o solicitar ayuda.",
      };
  }
}

export async function saveConfirmedTransaction(params: {
  supabase: SupabaseClient;
  userId: string;
  conversationId: string;
  draftId: string;
}): Promise<SaveConfirmedTransactionResult> {
  const { supabase, userId, conversationId, draftId } = params;
  const storedDraft = await findTransactionDraftById(supabase, {
    id: draftId,
    userId,
    conversationId,
  });

  if (!storedDraft) {
    throw new Error("El borrador no existe o no pertenece a esta conversación.");
  }
  if (storedDraft.status === "CANCELLED") {
    throw new Error("Este borrador fue descartado y ya no puede confirmarse.");
  }
  if (
    storedDraft.amount === null ||
    !storedDraft.date ||
    !storedDraft.category ||
    !storedDraft.merchant
  ) {
    throw new Error("El borrador todavía tiene datos pendientes.");
  }

  const storedSnapshot: ConfirmedDraftSnapshot = {
    type: storedDraft.type,
    amount: storedDraft.amount,
    date: storedDraft.date,
    category: storedDraft.category.trim().toLowerCase(),
    merchant: storedDraft.merchant,
    description: storedDraft.description,
  };

  if (storedDraft.status === "SAVED" && storedDraft.transactionId) {
    return {
      transactionId: storedDraft.transactionId,
      alreadySaved: true,
      draft: storedSnapshot,
    };
  }
  if (storedDraft.status !== "AWAITING_CONFIRMATION") {
    throw new Error("El borrador todavía no está listo para confirmarse.");
  }

  const resolvedCategory = await resolveUserCategory({
    supabase,
    userId,
    input: storedDraft.category,
    allowNewCategory: true,
  });
  const snapshot: ConfirmedDraftSnapshot = {
    ...storedSnapshot,
    category: resolvedCategory,
  };

  const insertData = {
    user_id: userId,
    type: snapshot.type,
    amount: snapshot.amount,
    date: snapshot.date,
    category: snapshot.category,
    merchant: snapshot.merchant,
    description: snapshot.description,
    source: "chat",
    status: "confirmed",
    origin_draft_id: draftId,
  };

  let transactionId: string;
  let inserted = false;
  const { data: insertedTransaction, error: insertError } = await supabase
    .from("transactions")
    .insert(insertData)
    .select("id")
    .single();

  if (insertError) {
    if (insertError.code !== "23505") {
      throw new Error(insertError.message || "No se pudo guardar la transacción.");
    }

    const { data: existingTransaction, error: existingError } = await supabase
      .from("transactions")
      .select("id")
      .eq("user_id", userId)
      .eq("origin_draft_id", draftId)
      .maybeSingle();

    if (existingError || !existingTransaction) {
      throw new Error(
        existingError?.message || "No se pudo recuperar la transacción ya confirmada.",
      );
    }

    transactionId = existingTransaction.id;
  } else if (insertedTransaction) {
    transactionId = insertedTransaction.id;
    inserted = true;
  } else {
    throw new Error("Supabase no devolvió la transacción guardada.");
  }

  await markTransactionDraftSaved(supabase, {
    id: draftId,
    userId,
    transactionId,
  });

  let alert: SaveConfirmedTransactionResult["alert"];

  if (inserted) {
    try {
      const [createdAlert] = await syncBudgetEffects({
        supabase,
        userId,
        changes: [
          {
            before: null,
            after: {
              type: snapshot.type,
              amount: snapshot.amount,
              date: snapshot.date,
              category: snapshot.category,
              status: "confirmed",
            },
          },
        ],
      });

      if (createdAlert) {
        alert = {
          message: createdAlert.message,
          level: createdAlert.level,
          alertId: createdAlert.alertId,
        };
      }
    } catch (error) {
      // La transacción ya fue confirmada. Una falla secundaria en alertas no
      // debe duplicarla ni dejar el borrador en un estado engañoso.
      console.error("[orchestrator] No se pudo sincronizar el presupuesto:", error);
    }

    try {
      await createTransactionNotification({
        supabase,
        userId,
        transaction: {
          transactionId,
          type: snapshot.type,
          amount: snapshot.amount,
          category: snapshot.category,
          merchant: snapshot.merchant,
          date: snapshot.date,
          channel: "chat",
        },
      });
    } catch (error) {
      console.error("[orchestrator] No se pudo crear la notificación del movimiento:", error);
    }
  }

  return {
    transactionId,
    alreadySaved: !inserted,
    draft: snapshot,
    alert,
  };
}
