-- ═══════════════════════════════════════════════════════════════
-- Warmup de Contas Novas
-- Contas com < 30 posts publicam em lotes de 10 com pausas de 8h.
-- Após 30 posts pelo ScaleMaster, is_warmed_up = true → modo normal.
--
-- Execute no Supabase Dashboard → SQL Editor
-- ═══════════════════════════════════════════════════════════════

ALTER TABLE public.instagram_accounts
  ADD COLUMN IF NOT EXISTS is_warmed_up       boolean    NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS warmup_posts_done  integer    NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS warmup_paused_until timestamptz;

-- Todas as contas existentes já estão aquecidas — pular warmup para elas.
UPDATE public.instagram_accounts SET is_warmed_up = true;
