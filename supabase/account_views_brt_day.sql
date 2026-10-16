-- Views da Dashboard: "hoje" vira à meia-noite de Brasília (2026-10-16).
--
-- Substitui get_account_views_summary de account_views_periods.sql. Os buckets
-- de account_views_daily continuam sendo dias UTC (única granularidade em que a
-- Meta soma sem sobreposição), mas a referência de "hoje" passa a ser a data
-- de Brasília em vez da data UTC. Antes o card zerava às 21h BRT (meia-noite
-- UTC); agora só vira às 00h BRT.
--
-- "Hoje" = bucket UTC com a mesma data do dia corrente em Brasília (cobre 21h
-- da véspera → 21h BRT). É o mesmo critério do alerta de meta de views
-- (app/api/cron/check-views-goal: dateKey = data BRT). O sync relê os dias
-- UTC [2, 1, 0], então o bucket de "hoje" continua sendo atualizado depois
-- das 21h BRT.

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
     where is_active and health_status <> 'error'
  ), v as (
    select d.day, d.views
      from account_views_daily d
      join accs a on a.id = d.account_id
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
    'accounts_total',   (select count(*) from accs),
    'accounts_synced',  (select count(*) from accs where views_synced_at is not null),
    'last_synced_at',   (select max(views_synced_at) from accs)
  );
$$;

revoke execute on function public.get_account_views_summary(uuid) from public, anon, authenticated;
grant execute on function public.get_account_views_summary(uuid) to service_role;
