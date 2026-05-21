-- ═══════════════════════════════════════════════════════════════
-- Failover de Contas — executar no Supabase SQL Editor
-- ═══════════════════════════════════════════════════════════════

-- 1. Adiciona colunas de saúde e prioridade na tabela de contas
ALTER TABLE public.instagram_accounts
  ADD COLUMN IF NOT EXISTS health_status text NOT NULL DEFAULT 'online'
    CHECK (health_status IN ('online', 'error', 'blocked')),
  ADD COLUMN IF NOT EXISTS failover_priority integer NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS instagram_accounts_failover_idx
  ON public.instagram_accounts(user_id, health_status, failover_priority);

-- 2. Inicializa prioridade para contas existentes (ordem de conexão)
UPDATE public.instagram_accounts a
SET failover_priority = sub.rn
FROM (
  SELECT id, ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY connected_at ASC) - 1 AS rn
  FROM public.instagram_accounts
) sub
WHERE a.id = sub.id AND a.failover_priority = 0;

-- 3. Tabela de logs de failover
CREATE TABLE IF NOT EXISTS public.failover_logs (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  failed_account_id uuid        NOT NULL REFERENCES public.instagram_accounts(id) ON DELETE CASCADE,
  backup_account_id uuid        REFERENCES public.instagram_accounts(id) ON DELETE SET NULL,
  error_reason      text,
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS failover_logs_user_id_idx
  ON public.failover_logs(user_id, created_at DESC);

ALTER TABLE public.failover_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users_manage_own_failover_logs"
  ON public.failover_logs FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
