BEGIN;

ALTER TABLE public.tickets
  ADD COLUMN IF NOT EXISTS assigned_to UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS resolution_note TEXT,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS resolved_at TIMESTAMPTZ;

GRANT UPDATE ON public.tickets TO authenticated;

DROP POLICY IF EXISTS "agents update tickets" ON public.tickets;
CREATE POLICY "agents update tickets"
ON public.tickets
FOR UPDATE
TO authenticated
USING (
  public.has_role(auth.uid(), 'agent')
  OR public.has_role(auth.uid(), 'admin')
)
WITH CHECK (
  public.has_role(auth.uid(), 'agent')
  OR public.has_role(auth.uid(), 'admin')
);

CREATE INDEX IF NOT EXISTS tickets_status_created_at_idx
  ON public.tickets (status, created_at DESC);

CREATE INDEX IF NOT EXISTS tickets_assigned_to_idx
  ON public.tickets (assigned_to)
  WHERE assigned_to IS NOT NULL;

COMMIT;
