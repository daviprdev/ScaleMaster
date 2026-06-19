-- Fila de processamento de vídeo por conta
-- Cada job representa um vídeo que precisa ser re-encodado com parâmetros
-- únicos por conta (fingerprint anti-detecção) antes de ser postado.
--
-- Fluxo:
--   process-loops  → INSERT status='queued' (sem FFmpeg)
--   process-videos → processa FFmpeg, UPDATE status='done', output_url preenchida
--   process-loops  → detecta status='done', usa output_url para criar container Meta

CREATE TABLE IF NOT EXISTS public.video_processing_jobs (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  loop_id       uuid        REFERENCES public.loops(id) ON DELETE SET NULL,
  account_id    uuid        NOT NULL REFERENCES public.instagram_accounts(id) ON DELETE CASCADE,
  video_id      uuid        NOT NULL REFERENCES public.videos_library(id) ON DELETE CASCADE,
  source_url    text        NOT NULL,
  effects       jsonb       NOT NULL DEFAULT '{}',
  status        text        NOT NULL DEFAULT 'queued'
                            CHECK (status IN ('queued', 'processing', 'done', 'error')),
  output_url    text,
  error_reason  text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  processed_at  timestamptz,
  expires_at    timestamptz NOT NULL DEFAULT now() + interval '2 hours'
);

CREATE INDEX IF NOT EXISTS vpj_status_created_at   ON public.video_processing_jobs(status, created_at);
CREATE INDEX IF NOT EXISTS vpj_account_loop_status ON public.video_processing_jobs(account_id, loop_id, status);
CREATE INDEX IF NOT EXISTS vpj_expires_at          ON public.video_processing_jobs(expires_at);

-- RLS: apenas service role acessa (crons usam SUPABASE_SERVICE_ROLE_KEY)
ALTER TABLE public.video_processing_jobs ENABLE ROW LEVEL SECURITY;
