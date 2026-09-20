-- ═══════════════════════════════════════════════════════════════════════════
-- Clonar Perfil — mídia resolvida por Reel (2026-09-20)
--
-- O prefetch do Clone precisa trocar o permalink do Instagram
-- (https://www.instagram.com/reel/{shortCode}/) por uma URL que a Meta
-- consiga baixar. Antes isso era rastreado escrevendo um marcador
-- "[APIFY_RUN:{id}]" em scheduled_posts.error_message (coluna de usuário,
-- que também guarda erro real) e o arquivo ia para temp/, que o cleanup do
-- process-loops apaga com 2h de vida — qualquer campanha mais longa que isso
-- perdia a mídia e morria com ERROR/EXPIRED.
--
-- Agora:
--   • clone_media   — estado por Reel (1 linha por permalink), com run da
--                     Apify, URL hospedada, tentativas e claim atômico.
--                     Reaproveitada entre contas E entre campanhas: o mesmo
--                     Reel nunca é baixado duas vezes enquanto o arquivo viver.
--   • scheduled_posts.clone_source_url — o permalink ORIGINAL, preservado
--                     mesmo depois de video_url virar a URL hospedada. É o que
--                     permite re-resolver a mídia se o arquivo sumir, em vez
--                     de deixar o post permanentemente quebrado.
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE public.scheduled_posts
  ADD COLUMN IF NOT EXISTS clone_source_url text;

COMMENT ON COLUMN public.scheduled_posts.clone_source_url IS
  'Permalink do Reel de origem (Clonar Perfil). Imutável: video_url passa a apontar para a cópia hospedada, esta coluna continua sendo a fonte.';

-- Backfill das campanhas antigas que ainda estão com o permalink em video_url.
UPDATE public.scheduled_posts
   SET clone_source_url = video_url
 WHERE clone_source_url IS NULL
   AND (video_url LIKE 'https://www.instagram.com/reel/%'
        OR video_url LIKE 'https://www.instagram.com/p/%');

-- Fila do prefetch: pendentes de clone, na ordem de quem posta primeiro.
CREATE INDEX IF NOT EXISTS scheduled_posts_clone_pending_idx
  ON public.scheduled_posts (status, scheduled_at)
  WHERE clone_source_url IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.clone_media (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Permalink do Reel. UNIQUE = uma resolução por Reel para todo o sistema.
  source_url     text        NOT NULL UNIQUE,
  short_code     text,
  status         text        NOT NULL DEFAULT 'queued'
                             CHECK (status IN ('queued', 'running', 'ready', 'error')),
  apify_run_id   text,
  hosted_url     text,
  storage_path   text,
  size_bytes     bigint,
  attempts       integer     NOT NULL DEFAULT 0,
  last_error     text,
  -- Claim atômico: duas invocações do cron nunca iniciam run/download do
  -- mesmo Reel ao mesmo tempo (o run da Apify é pago).
  claimed_until  timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS clone_media_status_idx ON public.clone_media (status, updated_at);

-- Só o service_role (cron) toca nesta tabela: RLS ligada sem nenhuma policy.
-- O conteúdo não é sensível (permalink público + URL de arquivo público), mas
-- não há motivo para expor a fila de processamento ao browser.
ALTER TABLE public.clone_media ENABLE ROW LEVEL SECURITY;
