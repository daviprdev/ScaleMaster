-- ─────────────────────────────────────────────────────────────────────────────
-- share_to_feed (Meta Content Publishing API, POST /{ig-user-id}/media)
-- Aplicada em 2026-09-06.
--
-- Documentação oficial (referência IG User Media):
--   "When true, indicates that the reel can appear in both the Feed and Reels
--    tabs. When false, indicates the reel can only appear in the Reels tab."
--   Aplica-se APENAS a media_type=REELS. Não existe para STORIES.
--
-- Colunas NULLABLE de propósito, com três estados:
--   true  → envia share_to_feed=true  (Reels + grade)
--   false → envia share_to_feed=false (somente Reels)
--   NULL  → NÃO envia o parâmetro — comportamento idêntico ao de antes desta
--           feature. A Meta não documenta o default do parâmetro, então não há
--           como afirmar o que acontecia com os posts antigos; deixar NULL
--           preserva exatamente o comportamento anterior em vez de assumir um
--           valor. Sem backfill: nenhum post/loop já existente muda de conduta.
-- ─────────────────────────────────────────────────────────────────────────────

-- Entidades de CONFIGURAÇÃO
alter table public.loops
  add column if not exists share_to_feed boolean;
alter table public.distribute_campaigns
  add column if not exists share_to_feed boolean;

-- Entidades de POSTAGEM CONCRETA (snapshot da decisão no momento da criação)
alter table public.scheduled_posts
  add column if not exists share_to_feed boolean;
alter table public.pending_containers
  add column if not exists share_to_feed boolean;

comment on column public.loops.share_to_feed is
  'REELS: true = Feed + aba Reels; false = só aba Reels; NULL = parâmetro não enviado (comportamento anterior a 2026-09-06).';
comment on column public.scheduled_posts.share_to_feed is
  'Snapshot da escolha no agendamento. NULL = parâmetro não enviado à Meta.';
comment on column public.pending_containers.share_to_feed is
  'Valor efetivamente enviado à Meta na criação do container. NULL = não enviado.';
comment on column public.distribute_campaigns.share_to_feed is
  'Preferência da campanha sincronizada; copiada para cada scheduled_post criado.';
