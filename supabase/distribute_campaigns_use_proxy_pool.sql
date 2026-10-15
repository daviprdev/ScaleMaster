-- Migration: Adiciona coluna use_proxy_pool à tabela distribute_campaigns
-- Data: 2026-10-15
-- Motivo: O código da rota /api/posts/distribute tenta inserir use_proxy_pool
--         mas a coluna nunca foi criada no banco de produção.
--
-- use_proxy_pool: boolean NOT NULL DEFAULT false
--   Quando true, a campanha usa proxies do estoque do usuário na publicação.
--   Snapshot da opção no momento da criação da campanha.

ALTER TABLE distribute_campaigns
  ADD COLUMN IF NOT EXISTS use_proxy_pool boolean NOT NULL DEFAULT false;