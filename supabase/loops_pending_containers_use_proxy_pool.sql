-- ---------------------------------------------------------------------------
-- Opção opt-in: usar proxies do estoque na publicação via Meta Graph API
-- para Loops e Pending Containers (2026-10-13)
--
-- loops.use_proxy_pool: configuração do loop — todos os containers gerados
-- por este loop herdam a opção. Padrão false (fluxo atual).
--
-- pending_containers.use_proxy_pool: snapshot da opção no momento da criação
-- do container. Alterar o loop depois não muda containers já criados.
-- ---------------------------------------------------------------------------

ALTER TABLE public.loops
ADD COLUMN IF NOT EXISTS use_proxy_pool boolean NOT NULL DEFAULT false;

ALTER TABLE public.pending_containers
ADD COLUMN IF NOT EXISTS use_proxy_pool boolean NOT NULL DEFAULT false;