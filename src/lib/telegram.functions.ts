// UBICACIÓN: src/lib/telegram.functions.ts

import { createServerFn } from "@tanstack/react-start";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

// Genera un token de un solo uso (vence en 15 minutos) y arma el link
// t.me/tu_bot?start=<token> que el usuario toca para vincular su cuenta.
export const createTelegramLinkToken = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;

    const botUsername = process.env.TELEGRAM_BOT_USERNAME;
    if (!botUsername) {
      throw new Error(
        "Falta configurar TELEGRAM_BOT_USERNAME (el @usuario de tu bot, sin la '@').",
      );
    }

    const token = crypto.randomUUID().replace(/-/g, "");

    const { error } = await supabase.from("telegram_link_tokens").insert({
      token,
      user_id: userId,
    });

    if (error) {
      throw new Error(error.message || "No se pudo generar el enlace de Telegram.");
    }

    return { link: `https://t.me/${botUsername}?start=${token}` };
  });

// Para mostrar en la web si la cuenta ya está conectada o no.
export const getTelegramLinkStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;

    const { data } = await supabase
      .from("profiles")
      .select("telegram_chat_id")
      .eq("id", userId)
      .maybeSingle();

    return { connected: Boolean(data?.telegram_chat_id) };
  });
