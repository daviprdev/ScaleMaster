-- AutoScale - Biblioteca de mídias de onboarding
-- Armazena fotos de perfil e mídias de story (fotos/vídeos) reutilizáveis entre templates.
-- Executar no Supabase SQL Editor.

CREATE TABLE IF NOT EXISTS onboarding_media_library (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- 'profile_photo' ou 'story_media'
  category TEXT NOT NULL CHECK (category IN ('profile_photo', 'story_media')),
  -- Nome amigável para o usuário identificar (ex: "Foto APP 04", "Story Promoção")
  name TEXT NOT NULL,
  -- Caminho no Supabase Storage (bucket onboarding-media)
  storage_path TEXT NOT NULL,
  -- URL pública para preview e uso no cron
  url TEXT NOT NULL,
  -- Tipo MIME (image/jpeg, video/mp4, etc)
  mime_type TEXT,
  -- Tamanho em bytes
  file_size BIGINT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- RLS: cada usuário só vê/edita suas próprias mídias
ALTER TABLE onboarding_media_library ENABLE ROW LEVEL SECURITY;

CREATE POLICY "media_select_own" ON onboarding_media_library
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "media_insert_own" ON onboarding_media_library
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "media_delete_own" ON onboarding_media_library
  FOR DELETE USING (auth.uid() = user_id);

-- Índice para listagem rápida por usuário e categoria
CREATE INDEX IF NOT EXISTS idx_onboarding_media_user_category
  ON onboarding_media_library(user_id, category, created_at DESC);

-- Bucket de storage (executar via Supabase Dashboard ou CLI)
-- INSERT INTO storage.buckets (id, name, public)
-- VALUES ('onboarding-media', 'onboarding-media', true)
-- ON CONFLICT (id) DO NOTHING;

-- Política de storage: usuários autenticados podem upload/download apenas dos próprios arquivos
-- CREATE POLICY "media_storage_upload" ON storage.objects
--   FOR INSERT WITH CHECK (
--     bucket_id = 'onboarding-media' AND
--     auth.uid()::text = (storage.foldername(name))[1]
--   );

-- CREATE POLICY "media_storage_read" ON storage.objects
--   FOR SELECT USING (bucket_id = 'onboarding-media');

-- CREATE POLICY "media_storage_delete" ON storage.objects
--   FOR DELETE USING (
--     bucket_id = 'onboarding-media' AND
--     auth.uid()::text = (storage.foldername(name))[1]
--   );