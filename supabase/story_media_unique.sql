-- Biblioteca de mídia de Stories: garante 1 registro por (usuário, arquivo).
-- Habilita upsert idempotente em story_media a partir de dois caminhos:
--   1) /api/stories/upload/complete (no momento do upload)
--   2) /api/posts/stories/post-now  (rede de segurança: toda mídia postada
--      como Story fica salva na biblioteca, mesmo se o registro do upload falhou)
-- Sem esse índice único o ON CONFLICT (user_id, storage_path) não teria alvo.
CREATE UNIQUE INDEX IF NOT EXISTS story_media_user_storage_path_key
  ON public.story_media (user_id, storage_path);
