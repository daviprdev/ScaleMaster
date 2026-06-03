-- Backoff exponencial para containers com "too many actions" (publish-pending)
-- Executar no Supabase SQL Editor antes do deploy.

ALTER TABLE public.pending_containers
  ADD COLUMN IF NOT EXISTS retry_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS retry_after  timestamptz;

CREATE INDEX IF NOT EXISTS pending_containers_retry_idx
  ON public.pending_containers (retry_after)
  WHERE status = 'pending';
