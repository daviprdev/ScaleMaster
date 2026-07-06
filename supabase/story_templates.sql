-- Templates de Story: importa um story ativo de uma conta e reposta em loop
-- Executar no Supabase SQL Editor

CREATE TABLE IF NOT EXISTS public.story_templates (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  source_account_id uuid REFERENCES public.instagram_accounts(id) ON DELETE SET NULL,
  media_url         text NOT NULL,
  media_type        text NOT NULL CHECK (media_type IN ('image', 'video')),
  interval_minutes  integer NOT NULL DEFAULT 1380, -- 23h — mantém o story sempre ativo (expira em 24h)
  last_posted_at    timestamptz,
  last_error        text,
  status            text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused')),
  created_at        timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS story_templates_user_id_idx ON public.story_templates(user_id);
CREATE INDEX IF NOT EXISTS story_templates_status_idx  ON public.story_templates(status);

ALTER TABLE public.story_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users_manage_own_story_templates"
  ON public.story_templates
  FOR ALL
  USING  (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Tabela relacional: quais contas recebem o repost do template
CREATE TABLE IF NOT EXISTS public.story_template_accounts (
  template_id uuid NOT NULL REFERENCES public.story_templates(id) ON DELETE CASCADE,
  account_id  uuid NOT NULL REFERENCES public.instagram_accounts(id) ON DELETE CASCADE,
  PRIMARY KEY (template_id, account_id)
);

CREATE INDEX IF NOT EXISTS story_template_accounts_template_id_idx ON public.story_template_accounts(template_id);
CREATE INDEX IF NOT EXISTS story_template_accounts_account_id_idx ON public.story_template_accounts(account_id);

ALTER TABLE public.story_template_accounts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users_manage_own_story_template_accounts"
  ON public.story_template_accounts
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.story_templates
      WHERE story_templates.id = story_template_accounts.template_id
        AND story_templates.user_id = auth.uid()
    )
  );
