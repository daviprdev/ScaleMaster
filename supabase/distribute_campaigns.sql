-- distribute_campaigns — configuração persistida das campanhas da aba Postar
-- que ficam "Sincronizadas com pasta de contas". Tabela criada originalmente
-- via MCP Supabase (2026-07-22), sem migration versionada até agora.
--
-- Refactor 2026-07-29: o cron sync-distribute-accounts deixou de matricular
-- contas novas em LOTE (todos os video_count posts de uma vez) e passou a
-- decidir, por conta, 1 post por vez — mesmo modelo do modo pasta do Loop
-- (isDue = agora >= último post + intervalo). O índice composto e o RPC
-- abaixo suportam essa checagem por conta sem escanear o histórico completo
-- de contas do lote clássico (que pode ter milhares de linhas).

CREATE TABLE IF NOT EXISTS public.distribute_campaigns (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  account_folder_ids uuid[] NOT NULL DEFAULT '{}',
  video_folder_id uuid NOT NULL,
  video_count integer NOT NULL,
  posts_per_day integer NOT NULL DEFAULT 1,
  captions text[] NOT NULL DEFAULT '{}',
  auto_caption_enabled boolean NOT NULL DEFAULT false,
  auto_caption_type text,
  account_stagger_seconds integer,
  burst_mode boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  syncing_at timestamptz
);

ALTER TABLE public.distribute_campaigns ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "users_manage_own_distribute_campaigns" ON public.distribute_campaigns;
CREATE POLICY "users_manage_own_distribute_campaigns" ON public.distribute_campaigns
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- Suporta get_distribute_account_states (agregação por conta+status)
CREATE INDEX IF NOT EXISTS idx_scheduled_posts_campaign_account_status
  ON public.scheduled_posts (campaign_id, account_id, status);

-- Uma linha por conta: total de posts já criados nesta campanha, quantos estão
-- em voo (pending/publishing) e o scheduled_at mais recente. Usado pelo cron
-- para decidir, por conta, se já pode criar o próximo post (isDue) sem puxar
-- o histórico linha a linha — contas do lote clássico podem ter milhares de
-- posts pré-agendados e não devem custar uma query proporcional a esse total.
CREATE OR REPLACE FUNCTION public.get_distribute_account_states(
  p_campaign_id uuid, p_account_ids uuid[]
) RETURNS TABLE (
  account_id uuid,
  total_count bigint,
  inflight_count bigint,
  last_scheduled_at timestamptz
) LANGUAGE sql STABLE AS $$
  SELECT account_id,
         COUNT(*) AS total_count,
         COUNT(*) FILTER (WHERE status IN ('pending','publishing')) AS inflight_count,
         MAX(scheduled_at) AS last_scheduled_at
  FROM public.scheduled_posts
  WHERE campaign_id = p_campaign_id AND account_id = ANY(p_account_ids)
  GROUP BY account_id
$$;
