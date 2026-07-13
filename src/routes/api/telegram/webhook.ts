// UBICACIÓN: src/routes/api/telegram/webhook.ts
// (vas a tener que crear las carpetas "api" y "telegram" adentro de src/routes)
//
// Esta es la puerta de entrada de Telegram: cada vez que alguien le escribe
// a tu bot, Telegram manda un POST acá. No reimplementamos el chatbot: este
// archivo llama a processChatMessage, el mismo cerebro que usa sendMessage
// en la web, y guarda todo en las mismas tablas conversations/messages.
//
// También maneja los botones inline de Confirmar/Descartar: cuando el
// usuario los toca, Telegram manda un update distinto (callback_query, no
// message), así que hay que procesar ambos tipos de payload por separado.
//
// NOTA sobre la bifurcación de soporte (caso vs. recomendación): acá el
// usuario responde escribiendo "1" o "2" (o "un caso" / "la recomendación")
// como texto normal, sin botones — processChatMessage ya resuelve eso
// mismo del lado del orquestador vía checkPendingSupportChoice, así que no
// hace falta lógica extra en este archivo, solo propagar el campo nuevo en
// el metadata al guardar la respuesta del asistente (ver handleUserMessage).
// Si más adelante querés botones inline "1) Abrir un caso / 2) Recomendación"
// como los de Confirmar/Descartar, avisame y lo agrego con el mismo patrón
// de confirmationKeyboard.

import { createFileRoute } from "@tanstack/react-router";
import type { SupabaseClient } from "@supabase/supabase-js";
import { processChatMessage } from "@/lib/agents/chat-flow.server";
import { saveConfirmedTransaction } from "@/lib/agents/orchestrator";
import { cancelTransactionDraft } from "@/lib/agents/transaction-drafts.server";

const TELEGRAM_API = "https://api.telegram.org";

type InlineKeyboard = {
  inline_keyboard: { text: string; callback_data: string }[][];
};

type TelegramMessage = {
  message_id?: number;
  chat?: { id?: number };
  text?: string;
  voice?: unknown;
  audio?: unknown;
};

type TelegramCallbackQuery = {
  id?: string;
  data?: string;
  message?: TelegramMessage;
};

type TelegramUpdate = {
  callback_query?: TelegramCallbackQuery;
  message?: TelegramMessage;
};

function isTelegramUpdate(value: unknown): value is TelegramUpdate {
  return typeof value === "object" && value !== null;
}

function confirmationKeyboard(draftId: string): InlineKeyboard {
  return {
    inline_keyboard: [
      [
        { text: "✅ Confirmar", callback_data: `confirm:${draftId}` },
        { text: "❌ Descartar", callback_data: `discard:${draftId}` },
      ],
    ],
  };
}

async function sendTelegramMessage(
  chatId: number,
  text: string,
  replyMarkup?: InlineKeyboard,
): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    console.error("[telegram] Falta la variable TELEGRAM_BOT_TOKEN.");
    return;
  }

  try {
    await fetch(`${TELEGRAM_API}/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
      }),
    });
  } catch (error) {
    console.error("[telegram] Error enviando mensaje:", error);
  }
}

// Saca los botones del mensaje original apenas se toca uno, para que no se
// pueda confirmar/descartar el mismo draft dos veces por doble tap.
async function editMessageReplyMarkup(chatId: number, messageId: number): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return;

  try {
    await fetch(`${TELEGRAM_API}/bot${token}/editMessageReplyMarkup`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        message_id: messageId,
        reply_markup: { inline_keyboard: [] },
      }),
    });
  } catch (error) {
    console.error("[telegram] Error quitando botones:", error);
  }
}

// Obligatorio: Telegram espera esta llamada apenas se toca un botón, si no
// el botón se queda "cargando" indefinidamente del lado del usuario.
async function answerCallbackQuery(callbackQueryId: string, text?: string): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return;

  try {
    await fetch(`${TELEGRAM_API}/bot${token}/answerCallbackQuery`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        callback_query_id: callbackQueryId,
        ...(text ? { text } : {}),
      }),
    });
  } catch (error) {
    console.error("[telegram] Error respondiendo callback_query:", error);
  }
}

// IMPORTANTE: ya NO filtramos por channel — mismo criterio que
// ensureConversation en chat.functions.ts. Un usuario tiene una única
// conversación activa sin importar si escribe desde la web o Telegram, así
// el historial queda unificado en ambos lados.
async function ensureTelegramConversation(
  supabase: SupabaseClient,
  userId: string,
): Promise<string> {
  const { data: existing } = await supabase
    .from("conversations")
    .select("id")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (existing?.id) return existing.id;

  const { data: created, error } = await supabase
    .from("conversations")
    .insert({ user_id: userId, channel: "telegram" })
    .select("id")
    .single();

  if (error || !created) {
    throw new Error(error?.message || "No se pudo crear la conversación de Telegram.");
  }

  return created.id;
}

// El usuario toca un link tipo t.me/tu_bot?start=<token> generado desde la
// web. Ese token vive en telegram_link_tokens y vincula su chat_id de
// Telegram con su user_id de Supabase.
async function handleStartCommand(
  supabase: SupabaseClient,
  chatId: number,
  token: string,
): Promise<void> {
  const { data: linkToken } = await supabase
    .from("telegram_link_tokens")
    .select("token, user_id, used_at, expires_at")
    .eq("token", token)
    .maybeSingle();

  if (!linkToken) {
    await sendTelegramMessage(
      chatId,
      "Ese enlace no es válido. Generá uno nuevo desde la app de Kintu.",
    );
    return;
  }

  if (linkToken.used_at) {
    await sendTelegramMessage(
      chatId,
      "Ese enlace ya fue usado. Si necesitás reconectar, generá uno nuevo desde la app.",
    );
    return;
  }

  if (new Date(linkToken.expires_at).getTime() < Date.now()) {
    await sendTelegramMessage(
      chatId,
      "Ese enlace expiró (duran 15 minutos). Generá uno nuevo desde la app de Kintu.",
    );
    return;
  }

  const { error: profileError } = await supabase
    .from("profiles")
    .update({ telegram_chat_id: chatId })
    .eq("id", linkToken.user_id);

  if (profileError) {
    console.error("[telegram] Error vinculando cuenta:", profileError);
    await sendTelegramMessage(
      chatId,
      "Tuvimos un problema conectando tu cuenta. Probá de nuevo en un momento.",
    );
    return;
  }

  await supabase
    .from("telegram_link_tokens")
    .update({ used_at: new Date().toISOString() })
    .eq("token", token);

  await sendTelegramMessage(
    chatId,
    "¡Listo! Tu cuenta de Kintu ya está conectada. Contame en qué gastaste o qué querés revisar, igual que en el chat web.",
  );
}

// Un mensaje normal (no /start): busca a qué usuario pertenece este chat_id
// y corre exactamente el mismo flujo que el chat web.
async function handleUserMessage(
  supabase: SupabaseClient,
  chatId: number,
  text: string,
): Promise<void> {
  const { data: profile } = await supabase
    .from("profiles")
    .select("id")
    .eq("telegram_chat_id", chatId)
    .maybeSingle();

  if (!profile) {
    await sendTelegramMessage(
      chatId,
      "Todavía no conecté tu cuenta de Kintu con este Telegram. Entrá a la app web y tocá 'Conectar Telegram' para vincularla.",
    );
    return;
  }

  const userId = profile.id;
  const conversationId = await ensureTelegramConversation(supabase, userId);

  const { error: userMessageError } = await supabase.from("messages").insert({
    conversation_id: conversationId,
    user_id: userId,
    role: "user",
    content: text,
  });
  if (userMessageError) {
    console.error("[telegram] Error guardando mensaje del usuario:", userMessageError);
  }

  const result = await processChatMessage({
    text,
    userId,
    supabase: supabase,
    conversationId,
  });

  const { error: assistantMessageError } = await supabase.from("messages").insert({
    conversation_id: conversationId,
    user_id: userId,
    role: "assistant",
    content: result.reply,
    metadata: {
      draft: result.draft || null,
      draft_id: result.draft_id || null,
      cancelled_draft_id: result.cancelled_draft_id || null,
      ticket_id: result.ticket_id || null,
      citations: result.citations || null,
      // Mismo campo que en chat.functions.ts: guarda la bifurcación
      // pendiente (¿caso o recomendación?) para que checkPendingSupportChoice
      // la lea en el próximo mensaje de este mismo usuario, sea desde la
      // web o desde Telegram — el estado vive en la conversación, no en el
      // canal.
      support_choice_pending: result.supportChoicePending ?? null,
    },
  });
  if (assistantMessageError) {
    console.error("[telegram] Error guardando respuesta del asistente:", assistantMessageError);
  }

  // Si el draft quedó completo (sin campos faltantes) y con id, es lo
  // mismo que en la web muestra los botones ✅/❌ — acá van como teclado
  // inline real de Telegram en vez de HTML.
  const readyForConfirmation = result.draft && result.draft.needs.length === 0 && result.draft_id;

  await sendTelegramMessage(
    chatId,
    result.reply,
    readyForConfirmation ? confirmationKeyboard(result.draft_id!) : undefined,
  );
}

// Se dispara cuando el usuario toca "✅ Confirmar" o "❌ Descartar".
async function handleCallbackQuery(
  supabase: SupabaseClient,
  callbackQuery: TelegramCallbackQuery,
): Promise<void> {
  const callbackId: string | undefined = callbackQuery?.id;
  const chatId = callbackQuery?.message?.chat?.id;
  const messageId = callbackQuery?.message?.message_id;
  const data: string | undefined = callbackQuery?.data;

  if (!callbackId) return;

  if (typeof chatId !== "number" || !data) {
    await answerCallbackQuery(callbackId);
    return;
  }

  const [action, draftId] = data.split(":");
  if (!draftId || (action !== "confirm" && action !== "discard")) {
    await answerCallbackQuery(callbackId, "Acción no reconocida.");
    return;
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("id")
    .eq("telegram_chat_id", chatId)
    .maybeSingle();

  if (!profile) {
    await answerCallbackQuery(callbackId, "Cuenta no conectada.");
    return;
  }
  const userId = profile.id;

  // El draft ya sabe a qué conversación pertenece — así el callback_data
  // solo necesita llevar el draftId (Telegram limita esto a 64 bytes,
  // un draftId + conversationId no entrarían los dos).
  const { data: draftRow } = await supabase
    .from("transaction_drafts")
    .select("conversation_id")
    .eq("id", draftId)
    .eq("user_id", userId)
    .maybeSingle();

  if (!draftRow) {
    await answerCallbackQuery(callbackId, "Ese borrador ya no existe.");
    return;
  }
  const conversationId = draftRow.conversation_id as string;

  if (messageId) await editMessageReplyMarkup(chatId, messageId);

  try {
    if (action === "confirm") {
      const saved = await saveConfirmedTransaction({
        supabase: supabase,
        userId,
        conversationId,
        draftId,
      });

      const kind = saved.draft.type === "income" ? "Ingreso" : "Gasto";
      const replyLines = [
        saved.alreadySaved
          ? `${kind} ya estaba guardado: USD ${saved.draft.amount.toFixed(2)} en ${saved.draft.category}.`
          : `${kind} guardado: USD ${saved.draft.amount.toFixed(2)} en ${saved.draft.category}.`,
      ];
      if (saved.alert) replyLines.push(saved.alert.message);
      const reply = replyLines.join(" ");

      if (!saved.alreadySaved) {
        await supabase.from("messages").insert({
          conversation_id: conversationId,
          user_id: userId,
          role: "assistant",
          content: reply,
          metadata: {
            alert: saved.alert || null,
            transaction_id: saved.transactionId,
            confirmed_draft_id: draftId,
          },
        });
      }

      await answerCallbackQuery(callbackId, "Confirmado ✅");
      await sendTelegramMessage(chatId, reply);
    } else {
      const state = await cancelTransactionDraft(supabase, {
        id: draftId,
        userId,
        conversationId,
      });
      const reply =
        state === "already_cancelled"
          ? "La transacción pendiente ya estaba descartada."
          : "Listo, descarté la transacción pendiente.";

      if (state === "cancelled") {
        await supabase.from("messages").insert({
          conversation_id: conversationId,
          user_id: userId,
          role: "assistant",
          content: reply,
          metadata: { cancelled_draft_id: draftId },
        });
      }

      await answerCallbackQuery(callbackId, "Descartado");
      await sendTelegramMessage(chatId, reply);
    }
  } catch (error) {
    console.error("[telegram webhook] Error en callback_query:", error);
    await answerCallbackQuery(callbackId, "Hubo un error, probá de nuevo.");
    await sendTelegramMessage(
      chatId,
      "Tuve un problema procesando tu confirmación. Probá de nuevo.",
    );
  }
}

export const Route = createFileRoute("/api/telegram/webhook")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const expectedSecret = process.env.TELEGRAM_WEBHOOK_SECRET;
        if (
          expectedSecret &&
          request.headers.get("x-telegram-bot-api-secret-token") !== expectedSecret
        ) {
          return new Response("Unauthorized", { status: 401 });
        }

        // Importación exclusivamente dentro del handler del servidor. Así la
        // service-role key nunca entra en el bundle del navegador.
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        let update: TelegramUpdate;
        try {
          const payload: unknown = await request.json();
          if (!isTelegramUpdate(payload)) {
            return new Response("Bad request", { status: 400 });
          }
          update = payload;
        } catch {
          return new Response("Bad request", { status: 400 });
        }

        // Los botones inline mandan un payload distinto (callback_query),
        // no message — hay que resolverlo antes de mirar update.message.
        if (update?.callback_query) {
          try {
            await handleCallbackQuery(supabaseAdmin, update.callback_query);
          } catch (error) {
            console.error("[telegram webhook] Error procesando callback_query:", error);
          }
          return new Response("OK");
        }

        const message = update?.message;
        const chatId = message?.chat?.id;
        const text: string | undefined = message?.text;

        // Ignoramos updates que no son mensajes de texto (stickers, ediciones, etc.)
        // Los mensajes de voz/audio no se procesan (Kintu no
        // transcribe todavía) — antes esto caía directo al "OK"
        // silencioso de abajo, y el usuario mandaba un audio sin
        // recibir ninguna respuesta. Ahora se lo avisamos.
        if (message?.voice || message?.audio) {
          if (typeof chatId === "number") {
            await sendTelegramMessage(
              chatId,
              'Por ahora no puedo escuchar audios 🎙️ — escribime el mensaje en texto, por ejemplo "gasté 5 en pizza".',
            );
          }
          return new Response("OK");
        }

        if (typeof chatId !== "number" || !text) {
          return new Response("OK");
        }

        try {
          if (text.startsWith("/start")) {
            const token = text.replace("/start", "").trim();
            if (token) {
              await handleStartCommand(supabaseAdmin, chatId, token);
            } else {
              await sendTelegramMessage(
                chatId,
                "Hola, soy Kintu. Conectá tu cuenta desde la app web (botón 'Conectar Telegram') para empezar.",
              );
            }
          } else {
            await handleUserMessage(supabaseAdmin, chatId, text);
          }
        } catch (error) {
          console.error("[telegram webhook] Error:", error);
          await sendTelegramMessage(
            chatId,
            "Tuve un problema procesando tu mensaje. Probá de nuevo en un momento.",
          );
        }

        // Telegram solo necesita una respuesta 200 rápida; el contenido no importa.
        return new Response("OK");
      },
    },
  },
});
