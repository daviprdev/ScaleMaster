-- Fase 40: Postagens Únicas/Agendadas
-- Executar no Supabase SQL Editor

CREATE TABLE IF NOT EXISTS public.single_posts (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  media_url     text NOT NULL,
  caption       text NOT NULL DEFAULT '',
  first_comment text NOT NULL DEFAULT '',
  post_type     text NOT NULL DEFAULT 'reel'
    CHECK (post_type IN ('reel', 'feed', 'story')),
  scheduled_for timestamptz,
  status        text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'publishing', 'published', 'failed', 'partial')),
  created_at    timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS single_posts_user_id_idx     ON public.single_posts(user_id);
CREATE INDEX IF NOT EXISTS single_posts_status_idx      ON public.single_posts(status);
CREATE INDEX IF NOT EXISTS single_posts_scheduled_idx   ON public.single_posts(scheduled_for);

ALTER TABLE public.single_posts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users_manage_own_single_posts"
  ON public.single_posts
  FOR ALL
  USING  (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Tabela relacional: qual post vai para qual conta
CREATE TABLE IF NOT EXISTS public.single_post_accounts (
  post_id       uuid NOT NULL REFERENCES public.single_posts(id) ON DELETE CASCADE,
  account_id    uuid NOT NULL REFERENCES public.instagram_accounts(id) ON DELETE CASCADE,
  status        text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'publishing', 'published', 'failed')),
  media_id      text,
  error_message text,
  published_at  timestamptz,
  PRIMARY KEY (post_id, account_id)
);

CREATE INDEX IF NOT EXISTS single_post_accounts_post_id_idx    ON public.single_post_accounts(post_id);
CREATE INDEX IF NOT EXISTS single_post_accounts_account_id_idx ON public.single_post_accounts(account_id);

ALTER TABLE public.single_post_accounts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users_manage_own_single_post_accounts"
  ON public.single_post_accounts
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.single_posts
      WHERE single_posts.id  = single_post_accounts.post_id
        AND single_posts.user_id = auth.uid()
    )
  );
