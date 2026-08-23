-- Cap de tentativas para ERROR/EXPIRED da Meta em scheduled_posts.
-- Sem essa coluna, um vídeo permanentemente rejeitado pela Meta (codec
-- incompatível etc.) ficava sendo recriado como container novo e falhando de
-- novo a cada execução do cron publish-scheduled, pra sempre — starvation da
-- fila (mesmo padrão já visto e documentado em 2026-07-05).
--
-- Aplicar no Supabase ANTES do deploy que usa app/api/cron/publish-scheduled/route.ts
-- com o cap de MAX_ERROR_EXPIRED_RETRIES (2026-08-23).

ALTER TABLE public.scheduled_posts
  ADD COLUMN IF NOT EXISTS retry_count integer NOT NULL DEFAULT 0;
