-- Onboarding Magic Tokens — tokens únicos para vincular contas Instagram via RPA worker
-- O worker RPA navega até /add/{token} no final do onboarding para completar a vinculação

CREATE TABLE IF NOT EXISTS public.onboarding_magic_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  token text NOT NULL UNIQUE,
  ig_app_id text,
  proxy_url_enc text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'used', 'expired')),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '72 hours'),
  used_at timestamptz,
  account_id uuid REFERENCES public.instagram_accounts(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.onboarding_magic_tokens ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users_read_own_magic_tokens" ON public.onboarding_magic_tokens FOR SELECT USING (auth.uid() = user_id);

CREATE INDEX idx_onboarding_magic_tokens_token ON public.onboarding_magic_tokens(token);
CREATE INDEX idx_onboarding_magic_tokens_status ON public.onboarding_magic_tokens(status) WHERE status = 'pending';