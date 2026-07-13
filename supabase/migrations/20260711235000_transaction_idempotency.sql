BEGIN;

-- Cada transacción confirmada desde el chat conserva el borrador que la originó.
-- La columna es nullable para no afectar transacciones históricas o sembradas.
ALTER TABLE public.transactions
  ADD COLUMN IF NOT EXISTS origin_draft_id UUID;

DO $$
BEGIN
  ALTER TABLE public.transactions
    ADD CONSTRAINT transactions_origin_draft_id_fkey
    FOREIGN KEY (origin_draft_id)
    REFERENCES public.transaction_drafts(id)
    ON DELETE SET NULL;
EXCEPTION
  WHEN duplicate_object THEN
    NULL;
END
$$;

-- PostgreSQL permite múltiples NULL en un índice UNIQUE, por lo que las
-- transacciones antiguas no entran en conflicto. Un borrador real, en cambio,
-- solo puede producir una transacción.
CREATE UNIQUE INDEX IF NOT EXISTS transactions_origin_draft_id_unique
  ON public.transactions (origin_draft_id);

COMMIT;
