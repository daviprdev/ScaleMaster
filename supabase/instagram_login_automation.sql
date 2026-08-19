-- Login automático de contas via instagrapi (substitui o clique manual no MoreLogin
-- para contas que já existem). Aplicado diretamente no Supabase via MCP em 2026-08-19;
-- este arquivo documenta o schema real já em produção (não precisa ser re-executado).

CREATE TABLE IF NOT EXISTS public.login_jobs (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  account_id        uuid        NOT NULL REFERENCES public.instagram_accounts(id) ON DELETE CASCADE,
  account_login_id  uuid        NOT NULL REFERENCES public.account_logins(id) ON DELETE CASCADE,
  status            text        NOT NULL DEFAULT 'queued'
                                CHECK (status IN ('queued', 'processing', 'done', 'error')),
  retry_count       integer     NOT NULL DEFAULT 0,
  retry_after       timestamptz,
  error_message     text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  processed_at      timestamptz
);

CREATE INDEX IF NOT EXISTS login_jobs_status_retry_idx ON public.login_jobs (status, retry_after);
CREATE INDEX IF NOT EXISTS login_jobs_account_id_idx ON public.login_jobs (account_id);

ALTER TABLE public.login_jobs ENABLE ROW LEVEL SECURITY;

-- Só leitura pelo próprio usuário (dono da conta) — todo write vem do
-- service role (rota /api/logins/auto-connect e o cron), que ignora RLS.
CREATE POLICY "users_view_own_login_jobs" ON public.login_jobs
  FOR SELECT USING (auth.uid() = user_id);

-- Distingue contas conectadas via OAuth oficial (Meta) das conectadas via
-- login automatizado instagrapi (sem token Meta, is_active=false por padrão).
ALTER TABLE public.instagram_accounts
  ADD COLUMN IF NOT EXISTS connection_method text NOT NULL DEFAULT 'oauth'
    CHECK (connection_method IN ('oauth', 'instagrapi'));

-- access_token (coluna já existente, sem uso desde a Fase 27) volta a ser usada
-- para instagrapi: guarda client.get_settings() serializado e encriptado
-- (lib/encrypt.ts) — device fingerprint + cookies de sessão da conta.
