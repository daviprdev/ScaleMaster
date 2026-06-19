-- Fase: Legendas Automáticas
-- Adiciona suporte a legendas automáticas (pool PT-BR) por tipo na tabela loops.
ALTER TABLE public.loops
  ADD COLUMN IF NOT EXISTS auto_caption_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS auto_caption_type    text
    CHECK (auto_caption_type IN ('curiosidades-gerais', 'curiosidades-tops', 'fatos-complexos'));
