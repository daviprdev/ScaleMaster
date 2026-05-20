-- Fase BYOC: tabela de apps Meta por usuário
-- Execute no Supabase Dashboard → SQL Editor

CREATE TABLE IF NOT EXISTS public.user_meta_apps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  app_name text NOT NULL,
  ig_app_id text NOT NULL,
  ig_app_secret text NOT NULL,  -- armazenado criptografado com AES-256-GCM
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS user_meta_apps_user_id_idx ON public.user_meta_apps(user_id);

ALTER TABLE public.user_meta_apps ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users_manage_own_meta_apps" ON public.user_meta_apps
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
