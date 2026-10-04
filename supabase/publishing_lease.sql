-- Migração: Adiciona publishing_started_at para claim/lease baseado em início de execução
-- Aplicação: Após media_priority_strategy.sql
-- Idempotente: pode ser executada múltiplas vezes

-- Adiciona coluna para registrar quando o processamento começou (não quando foi agendado)
ALTER TABLE scheduled_posts
ADD COLUMN IF NOT EXISTS publishing_started_at TIMESTAMPTZ;

-- Índice para recuperação eficiente de posts presos em "publishing"
CREATE INDEX IF NOT EXISTS idx_scheduled_posts_publishing_started
ON scheduled_posts(publishing_started_at)
WHERE status = 'publishing';

-- Comentário explicativo
COMMENT ON COLUMN scheduled_posts.publishing_started_at IS
'Timestamp when publishing started (for lease-based recovery, not scheduled_at)';