-- Adiciona 4 novos efeitos de vídeo à tabela loops
ALTER TABLE public.loops
  ADD COLUMN IF NOT EXISTS effect_zoom     boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS effect_blur     boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS effect_noise    boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS effect_anti_ai  boolean NOT NULL DEFAULT false;
