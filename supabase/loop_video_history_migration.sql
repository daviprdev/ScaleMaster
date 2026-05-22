-- ═══════════════════════════════════════════════════════════════
-- Loop Video History Migration
--
-- Adiciona rastreamento de vídeo por container para que o cron
-- possa filtrar vídeos já postados neste ciclo (anti-repetição).
--
-- Execute no Supabase Dashboard → SQL Editor
-- ═══════════════════════════════════════════════════════════════

-- 1. Rastreamento de qual vídeo gerou cada container
ALTER TABLE public.pending_containers
  ADD COLUMN IF NOT EXISTS video_id     uuid REFERENCES public.videos_library(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS cycle_number integer NOT NULL DEFAULT 0;

-- 2. Contador de ciclo atual no loop (incrementa quando o folder esgota em modo infinito)
ALTER TABLE public.loops
  ADD COLUMN IF NOT EXISTS current_cycle integer NOT NULL DEFAULT 0;

-- 3. Índice para a query de exclusão: "vídeos NÃO postados neste loop+ciclo"
--    Suporta a subquery: SELECT video_id FROM pending_containers
--    WHERE loop_id = $1 AND cycle_number = $2 AND status <> 'error'
CREATE INDEX IF NOT EXISTS pending_containers_loop_cycle_video_idx
  ON public.pending_containers (loop_id, cycle_number, video_id)
  WHERE loop_id IS NOT NULL
    AND video_id IS NOT NULL
    AND status <> 'error';
