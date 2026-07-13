BEGIN;

-- =========================================================
-- BORRADORES CONVERSACIONALES DE TRANSACCIONES
-- =========================================================
-- Permiten conservar el estado de un gasto o ingreso mientras
-- el usuario completa datos y confirma su registro.

CREATE TABLE public.transaction_drafts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  user_id UUID NOT NULL
    REFERENCES auth.users(id)
    ON DELETE CASCADE,

  conversation_id UUID NOT NULL
    REFERENCES public.conversations(id)
    ON DELETE CASCADE,

  type public.tx_type NOT NULL,

  amount NUMERIC(12,2)
    CHECK (amount IS NULL OR amount > 0),

  currency TEXT NOT NULL DEFAULT 'USD'
    CHECK (currency = 'USD'),

  date DATE,

  category TEXT,

  merchant TEXT,

  description TEXT,

  status TEXT NOT NULL DEFAULT 'NEEDS_INFO'
    CHECK (
      status IN (
        'NEEDS_INFO',
        'AWAITING_CONFIRMATION',
        'SAVED',
        'CANCELLED'
      )
    ),

  missing_fields TEXT[] NOT NULL DEFAULT '{}',

  transaction_id UUID
    REFERENCES public.transactions(id)
    ON DELETE SET NULL,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  confirmed_at TIMESTAMPTZ,

  cancelled_at TIMESTAMPTZ
);


-- Búsqueda rápida del borrador activo de una conversación.
CREATE INDEX transaction_drafts_conversation_status_idx
  ON public.transaction_drafts (
    conversation_id,
    status,
    updated_at DESC
  );


-- Solo puede existir un borrador activo por conversación.
CREATE UNIQUE INDEX transaction_drafts_one_active_per_conversation
  ON public.transaction_drafts (conversation_id)
  WHERE status IN (
    'NEEDS_INFO',
    'AWAITING_CONFIRMATION'
  );


-- Permisos.
GRANT SELECT, INSERT, UPDATE, DELETE
  ON public.transaction_drafts
  TO authenticated;

GRANT ALL
  ON public.transaction_drafts
  TO service_role;


-- Seguridad por usuario.
ALTER TABLE public.transaction_drafts
  ENABLE ROW LEVEL SECURITY;


CREATE POLICY "own transaction drafts"
  ON public.transaction_drafts
  FOR ALL
  TO authenticated
  USING (
    auth.uid() = user_id
  )
  WITH CHECK (
    auth.uid() = user_id
  );

COMMIT;
