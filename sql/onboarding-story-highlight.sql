-- ScaleMaster - Adiciona colunas story/highlight na tabela onboarding_jobs
-- Executar no Supabase SQL Editor antes de deployar o código novo.

ALTER TABLE onboarding_jobs
  ADD COLUMN IF NOT EXISTS story_media_url TEXT,
  ADD COLUMN IF NOT EXISTS story_link_url TEXT,
  ADD COLUMN IF NOT EXISTS highlight_title TEXT,
  ADD COLUMN IF NOT EXISTS story_pk TEXT;

-- Índices opcionais para queries futuras (ex: filtrar jobs sem story_pk)
-- CREATE INDEX IF NOT EXISTS idx_onboarding_jobs_story_pk ON onboarding_jobs(story_pk) WHERE story_pk IS NOT NULL;