-- ═══════════════════════════════════════════════════════════════
-- account_analytics_history — Snapshots diários por conta
-- Execute no Supabase Dashboard → SQL Editor
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.account_analytics_history (
  id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id               uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  account_id            uuid        NOT NULL REFERENCES public.instagram_accounts(id) ON DELETE CASCADE,
  date                  date        NOT NULL,
  followers_count       integer     NOT NULL DEFAULT 0,
  following_count       integer,
  posts_count           integer,
  automated_posts_count integer     NOT NULL DEFAULT 0,
  created_at            timestamptz DEFAULT now(),
  CONSTRAINT uq_account_analytics_date UNIQUE (account_id, date)
);

-- Índices para alta performance nas queries do dashboard
CREATE INDEX IF NOT EXISTS account_analytics_history_account_date_idx
  ON public.account_analytics_history(account_id, date DESC);

CREATE INDEX IF NOT EXISTS account_analytics_history_user_date_idx
  ON public.account_analytics_history(user_id, date DESC);

-- RLS
ALTER TABLE public.account_analytics_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users_manage_own_analytics_history"
  ON public.account_analytics_history FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
