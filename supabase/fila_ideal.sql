-- Raio-X da fila (2026-10-21) — regras em docs/fila-ideal.md.
--
-- O painel mede cada fila do Postar e do Loop pelas views dos posts maduros
-- (leitura de 4h+ depois da publicação). Este arquivo dá a ele o que faltava:
--
-- 1. insights_plays_at (scheduled_posts e pending_containers): hora da última
--    leitura que TROUXE views. insights_fetched_at não serve de prova — ele anda
--    mesmo quando a Meta falha (insightsUpdatePayload grava o carimbo e omite as
--    métricas nulas). Linhas antigas ficam nulas: o painel cai para
--    insights_fetched_at, linha a linha.
-- 2. pending_containers.published_at: hora real da publicação do Loop (gravada
--    pelo publish-pending). Sem ela o painel estima por created_at/retry_after,
--    com erro de ~3 min.
-- 3. distribute_campaigns.video_ids: vídeos de uma campanha montada em modo fila
--    ideal, na ordem do score (rodízio). Nulo = campanha comum.
-- 4. post_views_snapshots: cada leitura de views dos reels nas primeiras 48h,
--    gravada por trigger — base do selo "ainda subindo". Purga de 7 dias no cron
--    horário check-views-goal.
-- 5. Índices parciais das consultas do painel (posts publicados por fila e por
--    conta).
--
-- Aplicar à mão no Supabase SQL Editor. Idempotente. O app funciona sem ele:
-- o painel cai para as estimativas, o publish-pending repete o update sem
-- published_at, e o que falta aparece em missingSql.

-- ── 1–3. Colunas novas ──────────────────────────────────────────────────────
alter table public.scheduled_posts
  add column if not exists insights_plays_at timestamptz;

alter table public.pending_containers
  add column if not exists insights_plays_at timestamptz,
  add column if not exists published_at      timestamptz;

alter table public.distribute_campaigns
  add column if not exists video_ids uuid[];

-- ── 4. Histórico de leituras ────────────────────────────────────────────────
-- Sem FK de propósito: as linhas vivem 7 dias e não podem travar a exclusão de
-- post, conta, vídeo ou fila (mesma ideia de account_views_daily).
create table if not exists public.post_views_snapshots (
  id           bigint      generated always as identity primary key,
  source       text        not null check (source in ('posts', 'loop')),
  post_id      uuid        not null,
  account_id   uuid,
  user_id      uuid,
  -- campaign_id (Postar) ou loop_id (Loop).
  queue_id     uuid,
  video_id     uuid,
  published_at timestamptz,
  read_at      timestamptz not null,
  views        integer     not null
);

-- Só o servidor (service role) lê; só o trigger escreve. RLS ligado e nenhuma
-- policy → o navegador não enxerga nada, nem com JWT.
alter table public.post_views_snapshots enable row level security;
revoke all on public.post_views_snapshots from anon, authenticated;

create index if not exists post_views_snapshots_post_read_idx
  on public.post_views_snapshots (post_id, read_at);
create index if not exists post_views_snapshots_queue_read_idx
  on public.post_views_snapshots (queue_id, read_at);
-- Purga de 7 dias (check-views-goal).
create index if not exists post_views_snapshots_read_idx
  on public.post_views_snapshots (read_at);

-- Dispara só quando o UPDATE traz insights_plays — insightsUpdatePayload só
-- manda a coluna quando a Meta devolveu um número, então leitura que falhou não
-- passa por aqui. O "UPDATE OF" dispara mesmo com valor igual: a leitura conta
-- quando as views mudaram OU o carimbo da leitura andou.
--
-- A tabela de origem muda as colunas (campaign_id × loop_id, post_type só em
-- scheduled_posts): lidas por to_jsonb(new) para a mesma função servir às duas.
-- O snapshot fica num bloco com EXCEPTION: o sync de insights nunca falha por
-- causa dele (no pior caso perde uma leitura do histórico e avisa no log).
create or replace function public.track_post_views_snapshot()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row       jsonb;
  v_read_at   timestamptz;
  v_published timestamptz;
  v_source    text;
  v_queue_id  uuid;
begin
  if new.insights_plays is null
     or (new.insights_plays is not distinct from old.insights_plays
         and new.insights_fetched_at is not distinct from old.insights_fetched_at) then
    return new;
  end if;

  v_read_at := coalesce(new.insights_fetched_at, now());
  new.insights_plays_at := v_read_at;

  begin
    v_row := to_jsonb(new);

    if tg_table_name = 'scheduled_posts' then
      -- Story não entra no Raio-X (só reels).
      if coalesce(v_row->>'post_type', 'reel') = 'story' then
        return new;
      end if;
      v_source    := 'posts';
      v_published := (v_row->>'published_at')::timestamptz;
      v_queue_id  := (v_row->>'campaign_id')::uuid;
    else
      v_source    := 'loop';
      v_published := coalesce((v_row->>'published_at')::timestamptz,
                              (v_row->>'created_at')::timestamptz);
      v_queue_id  := (v_row->>'loop_id')::uuid;
    end if;

    -- Só as primeiras 48h interessam ao "ainda subindo"; depois disso a leitura
    -- não vira histórico (o sync relê posts antigos o tempo todo).
    if v_published is null or v_read_at - v_published > interval '48 hours' then
      return new;
    end if;

    insert into public.post_views_snapshots
      (source, post_id, account_id, user_id, queue_id, video_id, published_at, read_at, views)
    values (
      v_source,
      new.id,
      (v_row->>'account_id')::uuid,
      (v_row->>'user_id')::uuid,
      v_queue_id,
      (v_row->>'video_id')::uuid,
      v_published,
      v_read_at,
      new.insights_plays
    );
  exception when others then
    raise warning 'track_post_views_snapshot (%): % — %', tg_table_name, new.id, sqlerrm;
  end;

  return new;
end;
$$;

-- Função de trigger: o EXECUTE não é checado no disparo (ver
-- revoke_public_rpc_execute.sql) — ninguém precisa chamá-la pela API.
revoke execute on function public.track_post_views_snapshot() from public, anon, authenticated;

drop trigger if exists track_post_views_snapshot on public.scheduled_posts;
create trigger track_post_views_snapshot
  before update of insights_plays on public.scheduled_posts
  for each row execute function public.track_post_views_snapshot();

drop trigger if exists track_post_views_snapshot on public.pending_containers;
create trigger track_post_views_snapshot
  before update of insights_plays on public.pending_containers
  for each row execute function public.track_post_views_snapshot();

-- ── 5. Índices do painel ────────────────────────────────────────────────────
-- Posts publicados de uma fila (campanha/Loop) e de uma conta, por data.
-- O Loop ordena por created_at: published_at é nulo nas linhas antigas.
create index if not exists scheduled_posts_published_campaign_idx
  on public.scheduled_posts (campaign_id, published_at)
  where status = 'published';

create index if not exists scheduled_posts_published_account_idx
  on public.scheduled_posts (account_id, published_at)
  where status = 'published';

create index if not exists pending_containers_published_loop_idx
  on public.pending_containers (loop_id, created_at)
  where status = 'published';

create index if not exists pending_containers_published_account_idx
  on public.pending_containers (account_id, created_at)
  where status = 'published';

-- PostgREST passa a enxergar as colunas e a tabela novas sem esperar o reload
-- periódico.
notify pgrst, 'reload schema';

select
  (select count(*) from information_schema.columns
    where table_schema = 'public'
      and (table_name, column_name) in (
        ('scheduled_posts', 'insights_plays_at'),
        ('pending_containers', 'insights_plays_at'),
        ('pending_containers', 'published_at'),
        ('distribute_campaigns', 'video_ids'))) = 4                     as colunas,
  to_regclass('public.post_views_snapshots') is not null               as tabela,
  (select count(*) from pg_trigger
    where tgname = 'track_post_views_snapshot' and not tgisinternal) = 2 as triggers;
