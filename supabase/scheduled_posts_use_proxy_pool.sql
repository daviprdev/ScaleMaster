-- ---------------------------------------------------------------------------
-- Opção opt-in: usar proxies do estoque na publicação via Meta Graph API
-- (2026-10-13)
--
-- use_proxy_pool: boolean NOT NULL DEFAULT false
--   false → fluxo atual (chamada direta à Meta, sem proxy)
--   true  → no momento da execução, o worker seleciona um proxy ativo do
--           estoque do usuário (round-robin por post_id) e roteia as
--           chamadas à Meta Graph API através dele. A escolha é feita na
--           execução, não no agendamento — proxies mortos/indisponíveis
--           são ignorados automaticamente.
--
-- proxy_pool_id_used: uuid NULL
--   Registra qual proxy do estoque foi efetivamente usado nesta publicação,
--   para auditoria e diagnóstico. NULL quando use_proxy_pool=false ou
--   quando nenhum proxy estava disponível (erro visível, sem fallback).
-- ---------------------------------------------------------------------------

ALTER TABLE public.scheduled_posts
  ADD COLUMN IF NOT EXISTS use_proxy_pool boolean NOT NULL DEFAULT false;

ALTER TABLE public.scheduled_posts
  ADD COLUMN IF NOT EXISTS proxy_pool_id_used uuid REFERENCES public.proxy_pool(id) ON DELETE SET NULL;

-- Índice parcial: acelera queries de diagnóstico ("quais posts usaram proxy X?")
CREATE INDEX IF NOT EXISTS scheduled_posts_proxy_pool_used_idx
  ON public.scheduled_posts(proxy_pool_id_used)
  WHERE proxy_pool_id_used IS NOT NULL;