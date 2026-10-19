-- Efeito "Texto na tela" do Loop (2026-10-19).
--
-- Um pool de frases de gancho queimadas no vídeo via FFmpeg drawtext, com uma
-- frase diferente por conta/publicação (lib/video-text-overlay.ts). Idempotente:
-- pode rodar de novo sem efeito colateral.
--
-- Até esta migração rodar, o app segue funcionando: o painel e os crons caem
-- para a consulta sem estas colunas e o toggle avisa que a migração falta.

ALTER TABLE public.loops
  ADD COLUMN IF NOT EXISTS effect_text_enabled  boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS effect_text_pool     text[]  NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS effect_text_position text    NOT NULL DEFAULT 'top';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'loops_effect_text_position_check'
      AND conrelid = 'public.loops'::regclass
  ) THEN
    ALTER TABLE public.loops
      ADD CONSTRAINT loops_effect_text_position_check
      CHECK (effect_text_position IN ('top', 'middle'));
  END IF;
END $$;

-- PostgREST passa a enxergar as colunas novas sem esperar o reload periódico.
NOTIFY pgrst, 'reload schema';

SELECT count(*) = 3 AS aplicado
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'loops'
  AND column_name IN ('effect_text_enabled', 'effect_text_pool', 'effect_text_position');
