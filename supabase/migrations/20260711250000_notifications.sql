BEGIN;

-- =========================================================
-- NOTIFICACIONES
-- =========================================================
-- Bandeja única de notificaciones para el usuario, alimentada
-- desde tres fuentes:
--   1. 'budget' -> trigger automático cuando se crea una fila en `alerts`
--   2. 'ticket' -> trigger automático cuando se crea un ticket de soporte
--   3. 'chat_agent' -> insertada por el agente de notificaciones (LLM)
--      cuando detecta, durante una conversación, algo que amerita avisar
--      fuera del hilo del chat.

CREATE TABLE public.notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  user_id UUID NOT NULL
    REFERENCES auth.users(id)
    ON DELETE CASCADE,

  source TEXT NOT NULL
    CHECK (source IN ('budget', 'ticket', 'chat_agent')),

  level TEXT NOT NULL DEFAULT 'info'
    CHECK (level IN ('info', 'warning', 'urgent')),

  title TEXT NOT NULL,
  message TEXT NOT NULL,

  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,

  related_alert_id UUID
    REFERENCES public.alerts(id)
    ON DELETE SET NULL,

  related_ticket_id UUID
    REFERENCES public.tickets(id)
    ON DELETE SET NULL,

  read_at TIMESTAMPTZ,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX notifications_user_unread_idx
  ON public.notifications (user_id, created_at DESC)
  WHERE read_at IS NULL;

GRANT SELECT, UPDATE ON public.notifications TO authenticated;
GRANT ALL ON public.notifications TO service_role;

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

-- Los usuarios solo leen y marcan como leídas sus propias notificaciones.
-- La creación queda reservada al service_role (triggers) y a las llamadas
-- server-side del agente, que usan el cliente RLS-scoped del usuario pero
-- insertan explícitamente su propio user_id (igual que en `alerts`).
CREATE POLICY "own notifications read"
  ON public.notifications
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "own notifications update"
  ON public.notifications
  FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "own notifications insert"
  ON public.notifications
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- =========================================================
-- TRIGGER: alerta de presupuesto -> notificación
-- =========================================================
CREATE OR REPLACE FUNCTION public.notify_from_alert()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.notifications (user_id, source, level, title, message, related_alert_id)
  VALUES (
    NEW.user_id,
    'budget',
    CASE WHEN NEW.level = 'exceeded' THEN 'urgent' ELSE 'warning' END,
    CASE WHEN NEW.level = 'exceeded' THEN 'Presupuesto excedido' ELSE 'Cerca del límite de presupuesto' END,
    NEW.message,
    NEW.id
  );
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_alert_created
AFTER INSERT ON public.alerts
FOR EACH ROW EXECUTE FUNCTION public.notify_from_alert();

-- =========================================================
-- TRIGGER: ticket de soporte -> notificación
-- =========================================================
CREATE OR REPLACE FUNCTION public.notify_from_ticket()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.notifications (user_id, source, level, title, message, related_ticket_id)
  VALUES (
    NEW.user_id,
    'ticket',
    CASE WHEN NEW.priority = 'high' THEN 'urgent' ELSE 'info' END,
    'Se abrió un caso de soporte',
    NEW.summary,
    NEW.id
  );
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_ticket_created
AFTER INSERT ON public.tickets
FOR EACH ROW EXECUTE FUNCTION public.notify_from_ticket();

REVOKE EXECUTE ON FUNCTION public.notify_from_alert() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.notify_from_ticket() FROM PUBLIC, anon, authenticated;

COMMIT;
