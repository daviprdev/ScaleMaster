-- Views da Dashboard: "total" soma TODAS as contas, inclusive as caídas (2026-10-16).
--
-- Substitui get_account_views_summary de account_views_brt_day.sql. O card de
-- views mostra embaixo o total histórico de views; antes ele só somava contas
-- ativas e sem erro, então o número diminuía quando uma conta caía. Agora o
-- total soma account_views_daily inteira (contas inativas e com
-- health_status = 'error' incluídas). Os recortes por período (hoje, ontem,
-- 7d, 30d, mês) continuam só com as contas ativas e sem erro.
--
-- Contas EXCLUÍDAS do SaaS somem do total: account_views_daily tem
-- on delete cascade em instagram_accounts.

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
    'total',            coalesce((select sum(views) from account_views_daily), 0),
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
