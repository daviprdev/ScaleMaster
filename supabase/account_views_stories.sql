-- Views só de STORIES por conta e por dia (2026-11-06) — card "Views em
-- stories" da Dashboard, entre "Visualizações" e "Reels publicados".
--
-- Mesma fonte do card de Visualizações (insight de conta da Meta,
-- GET /{ig-user-id}/insights?metric=views&period=day&metric_type=total_value),
-- agora com `breakdown=media_product_type`: a Meta devolve o total e a fatia
-- de cada tipo (STORY, REEL, POST, CAROUSEL_CONTAINER, AD). Guardamos a fatia
-- STORY ao lado do total, na mesma linha de account_views_daily.
--
-- story_views NULL = dia lido antes do breakdown (ou chamada com breakdown
-- recusada e fallback sem ele). O sync nunca sobrescreve um valor real com
-- NULL. O backfill de 90 dias é refeito uma vez para todas as contas
-- (views_backfilled_at = null) para preencher o histórico; dias mais antigos
-- que 90 dias ficam sem fatia de stories.
--
-- Idempotente. Rodar ANTES do deploy (o upsert do sync grava story_views;
-- enquanto a coluna não existir, o sync cai no upsert sem ela).

alter table public.account_views_daily
  add column if not exists story_views bigint;

-- Refaz o backfill de 90 dias com breakdown. Contas em erro são puladas pelo
-- sync de qualquer forma.
update public.instagram_accounts
   set views_backfilled_at = null
 where views_backfilled_at is not null;

create or replace function public.get_account_views_summary(p_user_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with accs as (
    select id, views_synced_at
      from instagram_accounts
     where health_status <> 'error'
  ), v as (
    select day, views, story_views from account_views_daily
  ), ref as (
    select (now() at time zone 'America/Sao_Paulo')::date as today
  )
  select jsonb_build_object(
    'total',            coalesce((select sum(views) from v), 0),
    'today',            coalesce((select sum(views) from v, ref where day = ref.today), 0),
    'yesterday',        coalesce((select sum(views) from v, ref where day = ref.today - 1), 0),
    'last_7d',          coalesce((select sum(views) from v, ref where day >= ref.today - 6 and day <= ref.today), 0),
    'last_30d',         coalesce((select sum(views) from v, ref where day >= ref.today - 29 and day <= ref.today), 0),
    'month',            coalesce((select sum(views) from v, ref
                                   where day >= date_trunc('month', ref.today)::date
                                     and day <= ref.today), 0),
    'prev_month',       coalesce((select sum(views) from v, ref
                                   where day >= (date_trunc('month', ref.today) - interval '1 month')::date
                                     and day <  date_trunc('month', ref.today)::date), 0),
    'today_has_data',   exists (select 1 from v, ref where day = ref.today),
    -- Fatia STORY do mesmo insight (mesmos recortes).
    'stories_total',    coalesce((select sum(story_views) from v), 0),
    'stories_today',    coalesce((select sum(story_views) from v, ref where day = ref.today), 0),
    'stories_yesterday',coalesce((select sum(story_views) from v, ref where day = ref.today - 1), 0),
    'stories_last_7d',  coalesce((select sum(story_views) from v, ref where day >= ref.today - 6 and day <= ref.today), 0),
    'stories_month',    coalesce((select sum(story_views) from v, ref
                                   where day >= date_trunc('month', ref.today)::date
                                     and day <= ref.today), 0),
    'stories_has_data', exists (select 1 from v where story_views is not null),
    'accounts_total',   (select count(*) from accs),
    'accounts_synced',  (select count(*) from accs where views_synced_at is not null),
    'last_synced_at',   (select max(views_synced_at) from accs)
  );
$$;

revoke execute on function public.get_account_views_summary(uuid) from public, anon, authenticated;
grant execute on function public.get_account_views_summary(uuid) to service_role;

-- PostgREST guarda o esquema em cache: sem isto o app continua sem enxergar a coluna nova.
notify pgrst, 'reload schema';
