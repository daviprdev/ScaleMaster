-- ---------------------------------------------------------------------------
-- Contas Leitoras + Fila de Raspagem (2026-09-11)
--
-- Aquisição de conteúdo via contas dedicadas (instagrapi), complementando a
-- Apify na aba Inspirações. A Apify nunca traz a lista completa de reels de um
-- perfil e não vê conteúdo privado.
--
-- ISOLAMENTO DE RISCO (decisão do usuário): as contas leitoras são um pool
-- SEPARADO das contas de postagem (instagram_accounts). Uma conta que raspa
-- NUNCA é reaproveitada para postar, e vice-versa — se uma leitora cair, não
-- afeta o pipeline de postagem. Por isso esta tabela é independente, não uma
-- flag em instagram_accounts.
--
-- Segue os mesmos padrões já em produção:
--   - Criptografia AES-256-GCM (lib/encrypt.ts) em password/2FA/proxy/sessão,
--     igual a account_logins e instagram_accounts.proxy_url.
--   - device_seed determinístico por conta = a própria PK (igual ao cron de
--     login, que passa account.id como device_seed).
--   - session_settings guarda client.get_settings() serializado (device
--     fingerprint + cookies), permitindo reconectar sem logar de novo —
--     mesmo papel de instagram_accounts.access_token no login instagrapi.
--   - proxy_url COLADO por conta (não vem do estoque proxy_pool, cujo FK
--     aponta para instagram_accounts) — isolamento total de IP.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.reader_accounts (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  username          text        NOT NULL,
  password_enc      text        NOT NULL,           -- AES-256-GCM
  totp_secret_enc   text,                           -- AES-256-GCM (2FA opcional)
  proxy_url         text,                           -- AES-256-GCM (proxy dedicado, colado por conta)
  session_settings  text,                           -- AES-256-GCM: client.get_settings() serializado
  ig_user_id        text,
  full_name         text,
  followers_count   integer,
  media_count       integer,
  status            text        NOT NULL DEFAULT 'unverified'
                                CHECK (status IN ('unverified', 'online', 'error')),
  last_error        text,
  last_login_at     timestamptz,
  last_scrape_at    timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS reader_accounts_user_id_idx ON public.reader_accounts(user_id);

CREATE OR REPLACE FUNCTION public.set_reader_accounts_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS reader_accounts_updated_at ON public.reader_accounts;
CREATE TRIGGER reader_accounts_updated_at
  BEFORE UPDATE ON public.reader_accounts
  FOR EACH ROW EXECUTE FUNCTION public.set_reader_accounts_updated_at();

ALTER TABLE public.reader_accounts ENABLE ROW LEVEL SECURITY;

-- Dono faz tudo. Segredos (senha/2FA/proxy/sessão) nunca são devolvidos ao
-- browser pela API — a rota GET seleciona só colunas não-sensíveis.
DROP POLICY IF EXISTS "owner_only_reader_accounts" ON public.reader_accounts;
CREATE POLICY "owner_only_reader_accounts"
  ON public.reader_accounts
  FOR ALL
  USING  (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);


-- ── Fila de raspagem (scrape_jobs) ─────────────────────────────────────────
-- Mesmo padrão de login_jobs: claim atômico, retry_after + retry_count para
-- backoff exponencial, auto-healing de job preso em 'processing'. Todo write
-- vem do service role (rota de enfileiramento + cron), que ignora RLS; o
-- usuário só faz SELECT das próprias linhas.

CREATE TABLE IF NOT EXISTS public.scrape_jobs (
  id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  reader_account_id  uuid        NOT NULL REFERENCES public.reader_accounts(id) ON DELETE CASCADE,
  target_username    text        NOT NULL,
  limit_items        integer     NOT NULL DEFAULT 120,
  -- verify=true: job de verificação/conexão da própria conta leitora (target =
  -- username da leitora). Estabelece a sessão sem poluir o histórico de
  -- Inspirações (o cron pula o upsert em scraped_profiles nesse caso).
  verify             boolean     NOT NULL DEFAULT false,
  status             text        NOT NULL DEFAULT 'queued'
                                 CHECK (status IN ('queued', 'processing', 'done', 'error')),
  retry_count        integer     NOT NULL DEFAULT 0,
  retry_after        timestamptz,
  error_message      text,
  result_count       integer,
  created_at         timestamptz NOT NULL DEFAULT now(),
  processed_at       timestamptz
);

CREATE INDEX IF NOT EXISTS scrape_jobs_status_retry_idx ON public.scrape_jobs (status, retry_after);
CREATE INDEX IF NOT EXISTS scrape_jobs_reader_account_idx ON public.scrape_jobs (reader_account_id);
CREATE INDEX IF NOT EXISTS scrape_jobs_user_created_idx ON public.scrape_jobs (user_id, created_at DESC);

ALTER TABLE public.scrape_jobs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "users_view_own_scrape_jobs" ON public.scrape_jobs;
CREATE POLICY "users_view_own_scrape_jobs" ON public.scrape_jobs
  FOR SELECT USING (auth.uid() = user_id);
