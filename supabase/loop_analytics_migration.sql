-- ═══════════════════════════════════════════════════════════════
-- Loop Analytics Migration
-- Adiciona media_id e colunas de insights em pending_containers
-- para rastrear engajamento real por post de loop.
--
-- Execute no Supabase Dashboard → SQL Editor
-- ═══════════════════════════════════════════════════════════════

ALTER TABLE public.pending_containers
  ADD COLUMN IF NOT EXISTS media_id            text,
  ADD COLUMN IF NOT EXISTS insights_likes      integer,
  ADD COLUMN IF NOT EXISTS insights_comments   integer,
  ADD COLUMN IF NOT EXISTS insights_plays      integer,
  ADD COLUMN IF NOT EXISTS insights_reach      integer,
  ADD COLUMN IF NOT EXISTS insights_fetched_at timestamptz;

-- Índice para lookup por media_id (usado na API de insights)
CREATE INDEX IF NOT EXISTS pending_containers_media_id_idx
  ON public.pending_containers (media_id)
  WHERE media_id IS NOT NULL AND media_id <> '';

-- Índice para queries de analytics por loop (status + loop_id)
CREATE INDEX IF NOT EXISTS pending_containers_loop_status_idx
  ON public.pending_containers (loop_id, status)
  WHERE loop_id IS NOT NULL;
