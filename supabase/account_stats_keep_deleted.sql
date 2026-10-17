-- Views e reels de TODAS as contas, inclusive as excluídas do SaaS (2026-10-17).
--
-- account_views_daily e account_reels_daily tinham FK com ON DELETE CASCADE
-- para instagram_accounts: excluir uma conta caída apagava o histórico dela e
-- o total de views da Dashboard caía (medido: 3.312 views e 10 reels de
-- @phoebe22893 sumiram ao excluir a conta).
--
-- - Sem cascata: as linhas ficam (account_id vira só referência histórica).
-- - ig_user_id + username em cada linha: identificam a conta mesmo depois de
--   excluída. A chave de upsert do sync passa a ser (ig_user_id, day): excluir
--   e reconectar a MESMA conta do Instagram continua o histórico em vez de
--   contar em dobro (a reconexão cria outro instagram_accounts.id).
-- - get_account_views_summary: todos os recortes (hoje, ontem, 7d, 30d, mês)
--   somam todas as linhas, como o total e como os reels — conta caída,
--   desativada ou excluída inclusive. Conta caída simplesmente para de ganhar
--   dias novos (o sync pula health_status='error').
--
-- Idempotente. Rodar ANTES do deploy do sync que faz upsert por
-- (ig_user_id, day) — o índice único precisa existir.

alter table public.account_views_daily
  add column if not exists ig_user_id text,
  add column if not exists username   text;

alter table public.account_reels_daily
  add column if not exists ig_user_id text,
  add column if not exists username   text;

update public.account_views_daily d
   set ig_user_id = coalesce(d.ig_user_id, a.ig_business_account_id),
       username   = coalesce(d.username, a.username)
  from public.instagram_accounts a
 where a.id = d.account_id
   and (d.ig_user_id is null or d.username is null);

update public.account_reels_daily d
   set ig_user_id = coalesce(d.ig_user_id, a.ig_business_account_id),
       username   = coalesce(d.username, a.username)
  from public.instagram_accounts a
 where a.id = d.account_id
   and (d.ig_user_id is null or d.username is null);

alter table public.account_views_daily drop constraint if exists account_views_daily_account_id_fkey;
alter table public.account_reels_daily drop constraint if exists account_reels_daily_account_id_fkey;

create unique index if not exists account_views_daily_ig_day_key
  on public.account_views_daily (ig_user_id, day);
create unique index if not exists account_reels_daily_ig_day_key
  on public.account_reels_daily (ig_user_id, day);

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
    select day, views from account_views_daily
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
