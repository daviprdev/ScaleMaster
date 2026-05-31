-- Adiciona status 'publishing' como lock distribuído para evitar double-publish
-- em invocações concorrentes do publish-pending.
--
-- Fluxo:
--   pending → publishing (claim atômico, só um cron ganha)
--   publishing → published (sucesso)
--   publishing → error    (falha permanente)
--   publishing → pending  (erro transitório, retry no próximo ciclo)

ALTER TABLE public.pending_containers
  DROP CONSTRAINT IF EXISTS pending_containers_status_check;

ALTER TABLE public.pending_containers
  ADD CONSTRAINT pending_containers_status_check
  CHECK (status IN ('pending', 'publishing', 'published', 'error'));
