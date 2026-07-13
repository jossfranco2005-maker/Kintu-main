BEGIN;

-- Clave idempotente para evitar avisos repetidos cuando una operación se
-- reintenta o un trigger vuelve a ejecutarse.
ALTER TABLE public.notifications
  ADD COLUMN IF NOT EXISTS event_key TEXT;

UPDATE public.notifications
SET event_key = 'budget:alert:' || related_alert_id::text
WHERE event_key IS NULL
  AND related_alert_id IS NOT NULL;

UPDATE public.notifications
SET event_key = 'ticket:' || related_ticket_id::text || ':created'
WHERE event_key IS NULL
  AND related_ticket_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS notifications_event_key_uidx
  ON public.notifications (event_key);

-- =========================================================
-- ALERTA PRESUPUESTARIA -> NOTIFICACIÓN IDEMPOTENTE
-- =========================================================
CREATE OR REPLACE FUNCTION public.notify_from_alert()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.notifications (
    user_id,
    source,
    level,
    title,
    message,
    metadata,
    related_alert_id,
    event_key
  )
  VALUES (
    NEW.user_id,
    'budget',
    CASE WHEN NEW.level = 'exceeded' THEN 'urgent' ELSE 'warning' END,
    CASE
      WHEN NEW.level = 'exceeded' THEN 'Presupuesto excedido'
      ELSE 'Cerca del límite de presupuesto'
    END,
    NEW.message,
    jsonb_build_object(
      'event', NEW.level,
      'percentage', NEW.percentage,
      'budget_id', NEW.budget_id
    ),
    NEW.id,
    'budget:alert:' || NEW.id::text
  )
  ON CONFLICT (event_key) DO NOTHING;

  RETURN NEW;
END;
$$;

-- =========================================================
-- TICKET CREADO -> NOTIFICACIÓN IDEMPOTENTE
-- =========================================================
CREATE OR REPLACE FUNCTION public.notify_from_ticket()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.notifications (
    user_id,
    source,
    level,
    title,
    message,
    metadata,
    related_ticket_id,
    event_key
  )
  VALUES (
    NEW.user_id,
    'ticket',
    CASE WHEN NEW.priority = 'high' THEN 'urgent' ELSE 'info' END,
    'Se abrió un caso de soporte',
    NEW.summary,
    jsonb_build_object(
      'event', 'created',
      'status', NEW.status,
      'priority', NEW.priority
    ),
    NEW.id,
    'ticket:' || NEW.id::text || ':created'
  )
  ON CONFLICT (event_key) DO NOTHING;

  RETURN NEW;
END;
$$;

-- =========================================================
-- CAMBIO DE ESTADO DEL TICKET -> NOTIFICACIÓN AL CLIENTE
-- =========================================================
CREATE OR REPLACE FUNCTION public.notify_from_ticket_status()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  notification_level TEXT;
  notification_title TEXT;
  notification_message TEXT;
  notification_event TEXT;
  notification_key TEXT;
BEGIN
  IF OLD.status IS NOT DISTINCT FROM NEW.status THEN
    RETURN NEW;
  END IF;

  CASE NEW.status
    WHEN 'IN_REVIEW' THEN
      notification_level := 'info';
      notification_title := 'Tu caso está en revisión';
      notification_message := 'El equipo comenzó a revisar tu caso: ' || NEW.summary;
      notification_event := 'in_review';
    WHEN 'RESOLVED' THEN
      notification_level := 'info';
      notification_title := 'Tu caso fue resuelto';
      notification_message := CASE
        WHEN NULLIF(btrim(COALESCE(NEW.resolution_note, '')), '') IS NOT NULL
          THEN 'Resolución del equipo: ' || btrim(NEW.resolution_note)
        ELSE 'El equipo marcó como resuelto tu caso: ' || NEW.summary
      END;
      notification_event := 'resolved';
    WHEN 'PENDING_HUMAN_REVIEW' THEN
      notification_level := 'warning';
      notification_title := 'Tu caso volvió a revisión';
      notification_message := 'El caso volvió a la bandeja de revisión humana: ' || NEW.summary;
      notification_event := 'pending_review';
    ELSE
      RETURN NEW;
  END CASE;

  -- El id de transacción permite repetir un ciclo válido (reabrir y volver a
  -- resolver) sin duplicar un mismo reintento.
  notification_key := format(
    'ticket:%s:%s:%s',
    NEW.id,
    notification_event,
    txid_current()
  );

  INSERT INTO public.notifications (
    user_id,
    source,
    level,
    title,
    message,
    metadata,
    related_ticket_id,
    event_key
  )
  VALUES (
    NEW.user_id,
    'ticket',
    notification_level,
    notification_title,
    notification_message,
    jsonb_build_object(
      'event', notification_event,
      'previous_status', OLD.status,
      'status', NEW.status,
      'assigned_to', NEW.assigned_to,
      'resolved_at', NEW.resolved_at
    ),
    NEW.id,
    notification_key
  )
  ON CONFLICT (event_key) DO NOTHING;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_ticket_status_changed ON public.tickets;
CREATE TRIGGER on_ticket_status_changed
AFTER UPDATE OF status ON public.tickets
FOR EACH ROW
WHEN (OLD.status IS DISTINCT FROM NEW.status)
EXECUTE FUNCTION public.notify_from_ticket_status();

REVOKE EXECUTE ON FUNCTION public.notify_from_alert() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.notify_from_ticket() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.notify_from_ticket_status() FROM PUBLIC, anon, authenticated;

COMMIT;
