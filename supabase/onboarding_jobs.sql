-- ---------------------------------------------------------------------------
-- Onboarding automatizado de contas do Instagram (Fase Onboarding 1/3)
--
-- Substitui o onboarding manual (logar -> aceitar convite do App -> trocar foto
-- -> virar Profissional -> visitar link magico) por uma fila processada pelo
-- cron /api/cron/process-onboarding-jobs, que conversa com o python_server
-- (instagrapi, API privada do app mobile). Nada de navegador/RPA.
--
-- ORDEM DAS ETAPAS (obrigatoria): o link magico e um fluxo OAuth do Instagram
-- Business Login que so funciona em conta Business/Creator. A conversao para
-- profissional e PRE-REQUISITO do link, nunca efeito dele:
--
--   invite -> photo -> professional -> verify_professional -> magic_link -> done
--
-- Mesmo padrao de scrape_jobs / login_jobs, ja validado em producao:
--   - claim atomico (UPDATE ... WHERE status='pending')
--   - retry_after vira o carimbo do claim (auto-healing mede "preso" a partir
--     dele, nunca de created_at)
--   - retry_count conta falhas da ETAPA ATUAL (zera quando a etapa avanca)
--   - segredos AES-256-GCM via lib/encrypt.ts (senha, 2FA, proxy, sessao)
--
-- session_settings e TEXT (nao jsonb): guarda o ciphertext "iv:tag:enc" de
-- client.get_settings() serializado, igual a reader_accounts.session_settings.
-- Um jsonb so conseguiria guardar esse valor como string JSON, sem ganho.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.onboarding_jobs (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  username          text        NOT NULL,

  -- Etapa atual do pipeline. Quando status='done', fica em 'magic_link'.
  stage             text        NOT NULL DEFAULT 'invite'
                                CHECK (stage IN ('invite', 'photo', 'professional', 'verify_professional', 'magic_link')),
  -- Resultado por etapa: { "<stage>": { "state": "pending|ok|needs_manual|error",
  --   "reason": text, "at": timestamptz, "started_at": timestamptz } }
  stage_status      jsonb       NOT NULL DEFAULT '{}'::jsonb,

  password_enc      text        NOT NULL,           -- AES-256-GCM
  two_factor_enc    text,                           -- AES-256-GCM (segredo TOTP, opcional)
  proxy_url_enc     text,                           -- AES-256-GCM (proxy dedicado)
  session_settings  text,                           -- AES-256-GCM: client.get_settings() serializado

  photo_url         text,                           -- etapa photo (opcional: sem foto, etapa e pulada)
  magic_link        text,                           -- etapa magic_link (opcional)
  account_id        uuid        REFERENCES public.instagram_accounts(id) ON DELETE SET NULL,
  ig_user_id        text,

  status            text        NOT NULL DEFAULT 'pending'
                                CHECK (status IN ('pending', 'processing', 'done', 'error')),
  retry_count       integer     NOT NULL DEFAULT 0,
  retry_after       timestamptz,
  error_message     text,

  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  processed_at      timestamptz
);

CREATE INDEX IF NOT EXISTS onboarding_jobs_status_retry_idx
  ON public.onboarding_jobs (status, retry_after);
CREATE INDEX IF NOT EXISTS onboarding_jobs_user_created_idx
  ON public.onboarding_jobs (user_id, created_at DESC);

-- Uma conta nao pode ter dois onboardings em andamento ao mesmo tempo (dois
-- logins simultaneos na mesma conta, com a mesma device, e sinal de bot).
CREATE UNIQUE INDEX IF NOT EXISTS onboarding_jobs_active_username_uidx
  ON public.onboarding_jobs (user_id, lower(username))
  WHERE status IN ('pending', 'processing');

CREATE OR REPLACE FUNCTION public.set_onboarding_jobs_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS onboarding_jobs_updated_at ON public.onboarding_jobs;
CREATE TRIGGER onboarding_jobs_updated_at
  BEFORE UPDATE ON public.onboarding_jobs
  FOR EACH ROW EXECUTE FUNCTION public.set_onboarding_jobs_updated_at();

ALTER TABLE public.onboarding_jobs ENABLE ROW LEVEL SECURITY;

-- Dono: select/insert/update/delete das proprias linhas. O cron usa service_role, que
-- ignora RLS. Segredos nunca voltam ao browser: a rota GET seleciona so
-- colunas nao sensiveis.
DROP POLICY IF EXISTS "onboarding_jobs_owner_select" ON public.onboarding_jobs;
CREATE POLICY "onboarding_jobs_owner_select" ON public.onboarding_jobs
  FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "onboarding_jobs_owner_insert" ON public.onboarding_jobs;
CREATE POLICY "onboarding_jobs_owner_insert" ON public.onboarding_jobs
  FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "onboarding_jobs_owner_update" ON public.onboarding_jobs;
CREATE POLICY "onboarding_jobs_owner_update" ON public.onboarding_jobs
  FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- Remover o job apaga SO a linha da fila de onboarding. A unica FK aqui sai
-- desta tabela (account_id -> instagram_accounts, ON DELETE SET NULL) e nada
-- referencia onboarding_jobs: conta ja conectada continua intacta.
DROP POLICY IF EXISTS "onboarding_jobs_owner_delete" ON public.onboarding_jobs;
CREATE POLICY "onboarding_jobs_owner_delete" ON public.onboarding_jobs
  FOR DELETE USING (auth.uid() = user_id);
