-- Fase Stories: coluna post_type em scheduled_posts
-- Executar no Supabase SQL Editor

ALTER TABLE public.scheduled_posts
  ADD COLUMN IF NOT EXISTS post_type text NOT NULL DEFAULT 'reel'
  CHECK (post_type IN ('reel', 'story'));

CREATE INDEX IF NOT EXISTS idx_scheduled_posts_post_type
  ON public.scheduled_posts(post_type);
