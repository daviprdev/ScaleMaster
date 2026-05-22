-- ═══════════════════════════════════════════════════════════════
-- pending_containers — Motor de publicação em duas fases
--
-- Fase 1 (process-loops): cria o container na Meta e insere aqui.
-- Fase 2 (publish-pending): verifica status e publica quando FINISHED.
-- Isso evita timeout do Vercel pelo polling inline do processamento de vídeo.
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.pending_containers (
  id                     uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                uuid        NOT NULL REFERENCES auth.users(id)            ON DELETE CASCADE,
  loop_id                uuid        REFERENCES public.loops(id)                   ON DELETE SET NULL,
  account_id             uuid        NOT NULL REFERENCES public.instagram_accounts(id) ON DELETE CASCADE,
  ig_business_account_id text        NOT NULL,
  creation_id            text        NOT NULL,
  caption                text        NOT NULL DEFAULT '',
  status                 text        NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'published', 'error')),
  error_message          text,
  created_at             timestamptz NOT NULL DEFAULT now()
);

-- RLS: service_role (cron) bypasses RLS automatically.
-- Usuários comuns nunca acessam esta tabela via client.
ALTER TABLE public.pending_containers ENABLE ROW LEVEL SECURITY;

-- Índice para a query principal do cron (status + created_at)
CREATE INDEX IF NOT EXISTS pending_containers_status_created_idx
  ON public.pending_containers (status, created_at ASC);
