-- Views das contas por PERÍODO para a Dashboard (2026-09-13).
--
-- Substitui o retorno de get_account_views_summary: além do total, devolve
-- hoje / ontem / 7 dias / 30 dias / mês atual / mês anterior. Os "dias" são
-- dias UTC — é a única granularidade em que a Meta soma sem sobreposição
-- (medido: janela desde a meia-noite de Brasília volta arredondada para o dia
-- UTC). Na prática o dia vira às 21h de Brasília.
--
-- "Hoje" costuma ficar 0 nas primeiras horas do dia UTC: a Meta só libera o
-- dado do dia corrente com atraso. `today_has_data` deixa a UI avisar isso em
-- vez de mostrar um 0 enganoso.

-- Views globais: soma todas as contas ativas do SaaS (não filtra por usuário).
-- O parâmetro p_user_id é mantido apenas para compatibilidade de assinatura,
-- mas não é usado no filtro — as vendas também são globais.
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
    select (now() at time zone 'utc')::date as today
  )
  select jsonb_build_object(
    'total',            coalesce((select sum(views) from v), 0),
    'today',            coalesce((select sum(views) from v, ref where day = ref.today), 0),
    'yesterday',        coalesce((select sum(views) from v, ref where day = ref.today - 1), 0),
    'last_7d',          coalesce((select sum(views) from v, ref where day >= ref.today - 6), 0),
    'last_30d',         coalesce((select sum(views) from v, ref where day >= ref.today - 29), 0),
    'month',            coalesce((select sum(views) from v, ref where day >= date_trunc('month', ref.today)::date), 0),
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
