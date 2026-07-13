BEGIN;

-- Habilitar Telegram como canal válido de conversación.
ALTER TABLE public.conversations
  DROP CONSTRAINT IF EXISTS conversations_channel_check;

ALTER TABLE public.conversations
  ADD CONSTRAINT conversations_channel_check
  CHECK (channel IN ('web', 'whatsapp', 'telegram'));

-- Vínculo entre el usuario autenticado y su chat de Telegram.
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS telegram_chat_id BIGINT;

CREATE UNIQUE INDEX IF NOT EXISTS profiles_telegram_chat_id_key
  ON public.profiles (telegram_chat_id)
  WHERE telegram_chat_id IS NOT NULL;

-- Tokens de un solo uso para vincular la cuenta desde /start.
CREATE TABLE IF NOT EXISTS public.telegram_link_tokens (
  token TEXT PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT now() + interval '15 minutes',
  used_at TIMESTAMPTZ
);

GRANT SELECT, INSERT, UPDATE ON public.telegram_link_tokens TO authenticated;
GRANT ALL ON public.telegram_link_tokens TO service_role;

ALTER TABLE public.telegram_link_tokens ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "own link tokens" ON public.telegram_link_tokens;
CREATE POLICY "own link tokens"
  ON public.telegram_link_tokens
  FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

COMMIT;
