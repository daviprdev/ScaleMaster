-- Fase 39 (Cron de Loops): colunas de controle de execução
-- Executar no Supabase SQL Editor

ALTER TABLE public.loops
  ADD COLUMN IF NOT EXISTS last_posted_at  timestamptz,
  ADD COLUMN IF NOT EXISTS last_media_index int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS cycles_done      int NOT NULL DEFAULT 0;

-- Expandir constraint de status para incluir 'completed'
-- O nome gerado automaticamente pelo Postgres para inline CHECK é loops_status_check.
-- Se o ALTER abaixo falhar, consulte o nome real com:
--   SELECT conname FROM pg_constraint WHERE conrelid = 'public.loops'::regclass AND contype = 'c';
ALTER TABLE public.loops DROP CONSTRAINT IF EXISTS loops_status_check;
ALTER TABLE public.loops
  ADD CONSTRAINT loops_status_check
  CHECK (status IN ('active', 'paused', 'completed'));
