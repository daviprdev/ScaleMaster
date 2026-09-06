-- ─────────────────────────────────────────────────────────────────────────────
-- Exclusão segura de pasta da Biblioteca. Aplicada em 2026-09-06.
--
-- As FKs já estavam corretas em produção (verificado antes de qualquer
-- alteração) — nenhuma precisou ser mexida:
--   videos_library.folder_id             -> library_folders(id) ON DELETE SET NULL
--   loops.folder_id                      -> library_folders(id) ON DELETE SET NULL
--   automation_video_folders.folder_id   -> library_folders(id) ON DELETE CASCADE
--   distribute_campaigns.video_folder_id -> library_folders(id) ON DELETE CASCADE
--
-- Ou seja: nenhuma FK bloqueava o DELETE. O que faltava era registrar POR QUE
-- um Loop foi pausado quando a pasta de mídia dele deixa de existir — sem isso
-- ele ficaria "ativo" apontando para folder_id = NULL e falhando em silêncio.
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.loops
  add column if not exists paused_reason text;

comment on column public.loops.paused_reason is
  'Motivo legível de uma pausa automática (ex.: pasta de mídia removida). NULL quando o loop foi pausado manualmente ou está ativo.';
