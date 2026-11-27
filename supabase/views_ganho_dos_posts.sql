-- Views por dia a partir dos POSTS (2026-11-27) — cards de Visualizações da
-- Dashboard, total por conta da aba Contas e meta diária de views.
--
-- Problema: os cards liam só o insight de conta da Meta (account_views_daily).
-- Em 26/11 a Meta passou a recusar esse insight a partir das 17:15 BRT; os 374
-- posts publicados depois (75.888 views) nunca entraram, e o card "Ontem"
-- ficou em 11.424. Além disso o insight só existe em dia UTC (o "ontem" do
-- card terminava às 21h de Brasília) e a Meta consolida o dia com atraso.
--
-- Solução: cada leitura de views de um post (sync-post-insights a cada 5 min)
-- soma o GANHO desde a leitura anterior no dia de Brasília (se o intervalo
-- passou da meia-noite, reparte pelo tempo de cada lado):
--   post_views_counted       → maior número de views já contado por post
--                              (marca d'água: queda e volta não contam em dobro)
--   account_post_views_daily → ganho por conta (ig_user_id) e dia BRT, para sempre
-- account_views_effective junta as duas fontes por conta e dia:
--   ganho dos posts > 0 → ganho dos posts; senão → insight da conta.
-- decisão: não usar o maior dos dois. O insight é em dia UTC e o ganho em dia
-- BRT; as 3 h de diferença fariam a mesma view entrar em dois dias.
--
-- Backfill: dias BRT a partir de 26/11 saem das leituras guardadas em
-- post_views_snapshots (primeiras 48 h de cada reel). Dias antes de 26/11
-- continuam com o insight da conta (o histórico não muda).
--
-- Idempotente. Aplicar no SQL Editor (ou pelo MCP) ANTES do deploy.

-- ── Tabelas ────────────────────────────────────────────────────────────────
create table if not exists public.post_views_counted (
  source  text   not null check (source in ('posts', 'loop')),
  post_id uuid   not null,
  counted bigint not null,
  -- Quando o valor foi lido: o ganho seguinte é repartido entre os dias BRT
  -- pelo tempo decorrido desde esta leitura.
  counted_at timestamptz,
  primary key (source, post_id)
);

-- Sem FK de propósito (mesma ideia de account_views_daily): excluir post ou
-- conta não apaga o histórico de views.
create table if not exists public.account_post_views_daily (
  ig_user_id text        not null,
  account_id uuid,
  user_id    uuid,
  day        date        not null,
  views      bigint      not null default 0,
  updated_at timestamptz not null default now(),
  primary key (ig_user_id, day)
);

alter table public.post_views_counted add column if not exists counted_at timestamptz;

alter table public.post_views_counted       enable row level security;
alter table public.account_post_views_daily enable row level security;
revoke all on public.post_views_counted       from anon, authenticated;
revoke all on public.account_post_views_daily from anon, authenticated;

-- ── Trigger: ganho de cada leitura ─────────────────────────────────────────
create or replace function public.track_post_views_daily()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_src     text := case when tg_table_name = 'scheduled_posts' then 'posts' else 'loop' end;
  v_row     jsonb;
  v_prev    bigint;
  v_prev_at timestamptz;
  v_from    timestamptz;
  v_now     timestamptz := now();
  v_mid     timestamptz;
  v_today   date;
  v_delta   bigint;
  v_part    bigint;
  v_ig      text;
begin
  if new.insights_plays is null or new.account_id is null then
    return null;
  end if;

  begin
    select counted, counted_at into v_prev, v_prev_at
      from post_views_counted
     where source = v_src and post_id = new.id
       for update;

    v_delta := new.insights_plays - coalesce(v_prev, 0);
    if v_delta <= 0 then
      return null;
    end if;

    insert into post_views_counted (source, post_id, counted, counted_at)
    values (v_src, new.id, new.insights_plays, v_now)
    on conflict (source, post_id) do update
       set counted = excluded.counted, counted_at = excluded.counted_at;

    -- Início do intervalo do ganho: leitura anterior; na 1ª, a publicação.
    v_row  := to_jsonb(new);
    v_from := coalesce(v_prev_at,
                       (v_row->>'published_at')::timestamptz,
                       (v_row->>'created_at')::timestamptz,
                       v_now);

    select ig_business_account_id into v_ig
      from instagram_accounts
     where id = new.account_id;

    v_today := (v_now at time zone 'America/Sao_Paulo')::date;
    v_mid   := v_today::timestamp at time zone 'America/Sao_Paulo';

    -- Intervalo atravessou a meia-noite BRT: a parte de antes vai para ontem,
    -- na proporção do tempo (views de uma hora não pulam todas para o dia novo).
    v_part := v_delta;
    if v_from < v_mid and v_now > v_from then
      v_part := round(v_delta * extract(epoch from v_now - v_mid) / extract(epoch from v_now - v_from))::bigint;
      if v_delta - v_part > 0 then
        insert into account_post_views_daily (ig_user_id, account_id, user_id, day, views, updated_at)
        values (coalesce(v_ig, new.account_id::text), new.account_id, new.user_id,
                v_today - 1, v_delta - v_part, v_now)
        on conflict (ig_user_id, day) do update
           set views      = account_post_views_daily.views + excluded.views,
               updated_at = excluded.updated_at;
      end if;
    end if;

    if v_part > 0 then
      insert into account_post_views_daily (ig_user_id, account_id, user_id, day, views, updated_at)
      values (coalesce(v_ig, new.account_id::text), new.account_id, new.user_id,
              v_today, v_part, v_now)
      on conflict (ig_user_id, day) do update
         set views      = account_post_views_daily.views + excluded.views,
             account_id = excluded.account_id,
             user_id    = excluded.user_id,
             updated_at = excluded.updated_at;
    end if;
  exception when others then
    -- O sync de insights nunca falha por causa do histórico.
    raise warning 'track_post_views_daily (%): % — %', tg_table_name, new.id, sqlerrm;
  end;

  return null;
end;
$$;

revoke execute on function public.track_post_views_daily() from public, anon, authenticated;

-- ── Marca d'água inicial + backfill (uma vez só) ───────────────────────────
-- Só roda se a tabela de marca d'água está vazia: rodar o arquivo de novo não
-- conta nada em dobro.
do $$
begin
  if exists (select 1 from public.post_views_counted) then
    return;
  end if;

  -- Ganho por dia BRT (>= 26/11) a partir das leituras guardadas, com a mesma
  -- repartição na meia-noite que o trigger faz.
  insert into public.account_post_views_daily (ig_user_id, account_id, user_id, day, views, updated_at)
  with r as (
    select post_id, account_id, user_id, published_at, read_at, views::bigint as views,
           lag(read_at) over (partition by post_id order by read_at) as prev_at,
           (max(views) over (partition by post_id order by read_at
                             rows between unbounded preceding and 1 preceding))::bigint as prev_max
      from public.post_views_snapshots
     where account_id is not null
  ), g as (
    select account_id, user_id, read_at,
           case
             when prev_max is not null then greatest(views - prev_max, 0)
             -- 1ª leitura guardada: só conta se o post nasceu depois do início
             -- do histórico (senão faltam as leituras anteriores).
             when published_at >= (select min(read_at) from public.post_views_snapshots) then views
             else 0
           end as gain,
           coalesce(prev_at, published_at, read_at) as from_at,
           ((read_at at time zone 'America/Sao_Paulo')::date)::timestamp at time zone 'America/Sao_Paulo' as mid
      from r
  ), parts as (
    select account_id, user_id, (read_at at time zone 'America/Sao_Paulo')::date as d,
           case when from_at < mid and read_at > from_at
                then round(gain * extract(epoch from read_at - mid) / extract(epoch from read_at - from_at))::bigint
                else gain end as v
      from g
    union all
    select account_id, user_id, (read_at at time zone 'America/Sao_Paulo')::date - 1,
           gain - round(gain * extract(epoch from read_at - mid) / extract(epoch from read_at - from_at))::bigint
      from g
     where from_at < mid and read_at > from_at
  ), agg as (
    select coalesce(a.ig_business_account_id, p.account_id::text) as ig,
           (array_agg(p.account_id))[1] as account_id,
           (array_agg(p.user_id))[1]    as user_id,
           p.d,
           sum(p.v) as views
      from parts p
      left join public.instagram_accounts a on a.id = p.account_id
     where p.d >= date '2026-11-26'
     group by 1, 4
  )
  select ig, account_id, user_id, d, views, now()
    from agg
   where views > 0
  on conflict (ig_user_id, day) do update
     set views = excluded.views, updated_at = now();

  -- Daqui para a frente o trigger conta só o que passar do valor atual.
  insert into public.post_views_counted (source, post_id, counted, counted_at)
  select 'posts', id, insights_plays, coalesce(insights_fetched_at, now())
    from public.scheduled_posts where insights_plays is not null
  on conflict do nothing;

  insert into public.post_views_counted (source, post_id, counted, counted_at)
  select 'loop', id, insights_plays, coalesce(insights_fetched_at, now())
    from public.pending_containers where insights_plays is not null
  on conflict do nothing;
end;
$$;

drop trigger if exists track_post_views_daily on public.scheduled_posts;
create trigger track_post_views_daily
  after insert or update of insights_plays on public.scheduled_posts
  for each row execute function public.track_post_views_daily();

drop trigger if exists track_post_views_daily on public.pending_containers;
create trigger track_post_views_daily
  after insert or update of insights_plays on public.pending_containers
  for each row execute function public.track_post_views_daily();

-- ── Views efetivas por conta e dia ─────────────────────────────────────────
create or replace view public.account_views_effective
with (security_invoker = true) as
select coalesce(p.ig_user_id, a.ig_user_id) as ig_user_id,
       coalesce(p.account_id, a.account_id) as account_id,
       coalesce(p.user_id,    a.user_id)    as user_id,
       coalesce(p.day,        a.day)        as day,
       case when coalesce(p.views, 0) > 0 then p.views else coalesce(a.views, 0) end as views,
       a.views       as insight_views,
       p.views       as post_views,
       a.story_views as story_views
  from public.account_views_daily a
  full join public.account_post_views_daily p
    on p.ig_user_id = a.ig_user_id
   and p.day = a.day;

revoke all on public.account_views_effective from anon, authenticated;
grant select on public.account_views_effective to service_role;

-- ── Card da Dashboard ──────────────────────────────────────────────────────
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
    select day, views, story_views from account_views_effective
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
    'today_has_data',   exists (select 1 from v, ref where day = ref.today and views > 0),
    -- Fatia STORY do insight da conta (mesmos recortes).
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

notify pgrst, 'reload schema';

-- Conferência: dias BRT recentes, ganho dos posts × insight × efetivo.
select day,
       sum(post_views)    as posts,
       sum(insight_views) as insight,
       sum(views)         as efetivo
  from public.account_views_effective
 where day >= current_date - 3
 group by day
 order by day desc;
