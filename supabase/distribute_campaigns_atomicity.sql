-- Migração: Adiciona idempotency_key e status para atomicidade de campanhas
-- Aplicação: Após publishing_lease.sql
-- Idempotente: pode ser executada múltiplas vezes

-- Coluna para chave idempotente (hash do pedido) — evita duplicatas em retry/duplo clique
ALTER TABLE distribute_campaigns
ADD COLUMN IF NOT EXISTS idempotency_key TEXT;

-- Índice único por usuário para garantir idempotência
CREATE UNIQUE INDEX IF NOT EXISTS idx_distribute_campaigns_idempotency
ON distribute_campaigns(user_id, idempotency_key)
WHERE idempotency_key IS NOT NULL;

-- Coluna para estado de preparação (preparing → active)
-- Impede que workers consumam campanhas parciais ainda sendo montadas
ALTER TABLE distribute_campaigns
ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'active';

-- Índice para filtrar campanhas ativas rapidamente
CREATE INDEX IF NOT EXISTS idx_distribute_campaigns_status
ON distribute_campaigns(status)
WHERE status = 'active';

-- Comentário explicativo
COMMENT ON COLUMN distribute_campaigns.idempotency_key IS
'Hash SHA256 do pedido original — garante idempotência em retries/duplo clique';

COMMENT ON COLUMN distribute_campaigns.status IS
'Estado da campanha: preparing (montando posts) ou active (pronta para consumo)';