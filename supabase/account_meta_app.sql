-- Isolamento de App Meta por conta
-- Registra qual App Meta foi usado no OAuth de cada conta Instagram.
-- Permite refresh de token com as credenciais corretas e diagnóstico de cascade.

ALTER TABLE public.instagram_accounts
  ADD COLUMN IF NOT EXISTS meta_app_id uuid
    REFERENCES public.user_meta_apps(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS instagram_accounts_meta_app_id_idx
  ON public.instagram_accounts(meta_app_id);
