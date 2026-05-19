-- ═══════════════════════════════════════════════════════════════
-- Fase 35 — Manual Admin Approval Flow
-- Execute no Supabase Dashboard → SQL Editor
-- ═══════════════════════════════════════════════════════════════

-- 1. Adiciona coluna account_status na tabela user_roles
--    Valores: 'pending' | 'approved' | 'banned'
--    Default obrigatório: 'pending' (novos cadastros ficam aguardando)
ALTER TABLE public.user_roles
  ADD COLUMN IF NOT EXISTS account_status text NOT NULL DEFAULT 'pending'
  CHECK (account_status IN ('pending', 'approved', 'banned'));

-- 2. Aprova todos os usuários JÁ existentes (admin incluído)
--    Garante que nenhuma conta ativa seja bloqueada pela migração
UPDATE public.user_roles
  SET account_status = 'approved';

-- 3. A partir daqui, novos signups → trigger insere row com
--    account_status = 'pending' (o DEFAULT da coluna)
--    Admins precisam aprovar manualmente em /admin/users
