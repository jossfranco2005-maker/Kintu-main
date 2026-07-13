BEGIN;

-- =========================================================
-- FUENTES DE NOTIFICACIÓN Y RELACIÓN CON MOVIMIENTOS
-- =========================================================
ALTER TABLE public.notifications
  DROP CONSTRAINT IF EXISTS notifications_source_check;

ALTER TABLE public.notifications
  ADD CONSTRAINT notifications_source_check
  CHECK (source IN ('budget', 'ticket', 'chat_agent', 'transaction', 'import'));

ALTER TABLE public.notifications
  ADD COLUMN IF NOT EXISTS related_transaction_id UUID
  REFERENCES public.transactions(id)
  ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS notifications_related_transaction_idx
  ON public.notifications (related_transaction_id)
  WHERE related_transaction_id IS NOT NULL;

-- =========================================================
-- RECUPERAR ALERTAS HISTÓRICAS SIN NOTIFICACIÓN
-- =========================================================
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
SELECT
  a.user_id,
  'budget',
  CASE WHEN a.level = 'exceeded' THEN 'urgent' ELSE 'warning' END,
  CASE
    WHEN a.level = 'exceeded' THEN 'Presupuesto excedido'
    ELSE 'Cerca del límite de presupuesto'
  END,
  a.message,
  jsonb_build_object(
    'event', a.level,
    'percentage', a.percentage,
    'budget_id', a.budget_id,
    'backfilled', true
  ),
  a.id,
  'budget:alert:' || a.id::text
FROM public.alerts a
WHERE NOT EXISTS (
  SELECT 1
  FROM public.notifications n
  WHERE n.related_alert_id = a.id
     OR n.event_key = 'budget:alert:' || a.id::text
)
ON CONFLICT (event_key) DO NOTHING;

-- =========================================================
-- LECTURA DE NOTIFICACIÓN <-> ALERTA RECONOCIDA
-- =========================================================
CREATE OR REPLACE FUNCTION public.acknowledge_alert_from_notification()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.related_alert_id IS NOT NULL
     AND OLD.read_at IS NULL
     AND NEW.read_at IS NOT NULL THEN
    UPDATE public.alerts
    SET acknowledged = true
    WHERE id = NEW.related_alert_id
      AND user_id = NEW.user_id
      AND acknowledged = false;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_notification_read_ack_alert ON public.notifications;
CREATE TRIGGER on_notification_read_ack_alert
AFTER UPDATE OF read_at ON public.notifications
FOR EACH ROW
WHEN (OLD.read_at IS NULL AND NEW.read_at IS NOT NULL)
EXECUTE FUNCTION public.acknowledge_alert_from_notification();

CREATE OR REPLACE FUNCTION public.read_notification_from_alert_ack()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF OLD.acknowledged = false AND NEW.acknowledged = true THEN
    UPDATE public.notifications
    SET read_at = COALESCE(read_at, now())
    WHERE related_alert_id = NEW.id
      AND user_id = NEW.user_id;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_alert_ack_read_notification ON public.alerts;
CREATE TRIGGER on_alert_ack_read_notification
AFTER UPDATE OF acknowledged ON public.alerts
FOR EACH ROW
WHEN (OLD.acknowledged = false AND NEW.acknowledged = true)
EXECUTE FUNCTION public.read_notification_from_alert_ack();

REVOKE EXECUTE ON FUNCTION public.acknowledge_alert_from_notification()
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.read_notification_from_alert_ack()
  FROM PUBLIC, anon, authenticated;

-- =========================================================
-- BASE DE CONOCIMIENTO ALINEADA CON EL PERFIL REAL
-- =========================================================
UPDATE public.knowledge_articles
SET
  content = 'Puedes cambiar tu nombre visible desde Perfil usando la opción Editar. El correo de acceso no se modifica directamente desde Kintu; por seguridad, solicita ayuda al equipo de soporte para validarlo. Kintu no cambia datos sensibles sin revisión.',
  version = GREATEST(version, 2),
  updated_at = now()
WHERE title = 'Cómo actualizar mis datos personales';

COMMIT;
