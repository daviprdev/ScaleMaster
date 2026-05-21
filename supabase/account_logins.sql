-- ── Cofre de Logins (account_logins) ─────────────────────────────────────
-- Execute no SQL Editor do Supabase

CREATE TABLE IF NOT EXISTS public.account_logins (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  profile_name   text        NOT NULL,
  username       text        NOT NULL,
  password_hash  text        NOT NULL,
  recovery_email text,
  two_factor_key text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

-- Index para lookup por usuário
CREATE INDEX IF NOT EXISTS account_logins_user_id_idx
  ON public.account_logins(user_id);

-- Trigger: atualiza updated_at automaticamente
CREATE OR REPLACE FUNCTION public.set_account_logins_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS account_logins_updated_at ON public.account_logins;
CREATE TRIGGER account_logins_updated_at
  BEFORE UPDATE ON public.account_logins
  FOR EACH ROW EXECUTE FUNCTION public.set_account_logins_updated_at();

-- RLS obrigatório
ALTER TABLE public.account_logins ENABLE ROW LEVEL SECURITY;

-- Política rigorosa: somente o dono pode SELECT / INSERT / UPDATE / DELETE
CREATE POLICY "owner_only_logins"
  ON public.account_logins
  FOR ALL
  USING  (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
