-- ---------------------------------------------------------------------------
-- Sessões de navegador (Playwright) por conta do Instagram — motor "browser"
--
-- Motor paralelo ao instagrapi: 1 conta = 1 contexto de navegador isolado =
-- 1 proxy fixa. Depois do primeiro login no instagram.com, o storage_state do
-- Playwright (cookies + localStorage) é salvo aqui e as sessões seguintes
-- começam já logadas, sem passar pela tela de login.
--
-- Por que tabela própria e não coluna em instagram_accounts: a conta em
-- onboarding só vira linha de instagram_accounts no FIM do fluxo (link
-- mágico). A sessão do navegador precisa existir desde a primeira etapa
-- (aceitar convite) e continuar valendo depois (story com link, destaque).
-- A chave é (user_id, username) — serve às duas fases sem migração de dados.
--
-- storage_state_enc: AES-256-GCM no MESMO formato de lib/encrypt.ts
-- ("iv:tag:enc" base64, chave = sha256(ENCRYPTION_SECRET)). Gravado pelo
-- python_server (service_role) e legível pelo Next.js com decrypt().
--
-- fingerprint: user agent / viewport / locale / timezone usados no login.
-- Reusado nas sessões seguintes — cookie de uma "máquina" aparecendo em outra
-- é sinal clássico de roubo de sessão para o risk engine.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.ig_browser_sessions (
  id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  username           text        NOT NULL CHECK (username = lower(username)),

  storage_state_enc  text,
  fingerprint        jsonb       NOT NULL DEFAULT '{}'::jsonb,

  status             text        NOT NULL DEFAULT 'active'
                                 CHECK (status IN ('active', 'expired', 'invalid')),
  proxy_exit_ip      text,
  last_login_at      timestamptz,
  last_used_at       timestamptz,
  last_error         text,

  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT ig_browser_sessions_user_username_key UNIQUE (user_id, username)
);

CREATE OR REPLACE FUNCTION public.set_ig_browser_sessions_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS ig_browser_sessions_updated_at ON public.ig_browser_sessions;
CREATE TRIGGER ig_browser_sessions_updated_at
  BEFORE UPDATE ON public.ig_browser_sessions
  FOR EACH ROW EXECUTE FUNCTION public.set_ig_browser_sessions_updated_at();

ALTER TABLE public.ig_browser_sessions ENABLE ROW LEVEL SECURITY;

-- Dono só LÊ (e só colunas não sensíveis devem ir ao browser — o ciphertext
-- não é útil sem ENCRYPTION_SECRET, mas nenhuma rota deve selecioná-lo).
-- Escrita exclusivamente pelo servidor (service_role ignora RLS).
DROP POLICY IF EXISTS "ig_browser_sessions_owner_select" ON public.ig_browser_sessions;
CREATE POLICY "ig_browser_sessions_owner_select" ON public.ig_browser_sessions
  FOR SELECT USING (auth.uid() = user_id);
