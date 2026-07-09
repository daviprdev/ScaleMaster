-- Rastreamento de falhas de proxy por conta (detecção de queda global do provedor)
-- Aplicado no Supabase em 2026-07-09 (outage gbproxies: todos os IPs removidos da conta).
--
-- Gravado por: process-loops, publish-pending, publish-scheduled, story-templates
-- (via recordProxyFailure em lib/proxy.ts) sempre que uma chamada à Meta API
-- falha por erro de rede do proxy dedicado da conta.
--
-- Lido por: app/dashboard/layout.tsx — ProxyOutageBanner aparece quando 3+ contas
-- têm last_proxy_error_at nos últimos 30 minutos.

ALTER TABLE public.instagram_accounts
  ADD COLUMN IF NOT EXISTS last_proxy_error_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_proxy_error text;

CREATE INDEX IF NOT EXISTS instagram_accounts_last_proxy_error_at_idx
  ON public.instagram_accounts(last_proxy_error_at)
  WHERE last_proxy_error_at IS NOT NULL;
