-- Magic Add Tokens — link público por conta para adicionar contas Instagram sem login no SaaS
CREATE TABLE IF NOT EXISTS public.magic_add_tokens (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid        NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  app_id     uuid        REFERENCES public.user_meta_apps(id) ON DELETE SET NULL,
  token      uuid        NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.magic_add_tokens ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users_manage_own_magic_tokens"
  ON public.magic_add_tokens FOR ALL
  USING  (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
