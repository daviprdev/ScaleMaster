-- Fase: Proxy dedicado por conta
-- Adiciona coluna proxy_url (AES-256-GCM via ENCRYPTION_SECRET) em instagram_accounts.
-- O valor é criptografado pelo servidor antes de ser salvo e descriptografado em lib/proxy.ts.
-- NULL = sem proxy dedicado → fallback para PROXY_URL_TEMPLATE ou IP direto do servidor.

ALTER TABLE public.instagram_accounts
  ADD COLUMN IF NOT EXISTS proxy_url text;
