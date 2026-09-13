-- Views REAIS por conta, dia a dia (2026-09-13).
--
-- A Dashboard somava só as views dos posts que o SaaS publicou/registrou —
-- ~30 de ~120 posts por conta. O número que o Instagram mostra (e que outros
-- SaaS exibem) é o insight de CONTA: GET /{ig-user-id}/insights?metric=views
-- &period=day&metric_type=total_value&since&until. Medido em produção:
-- @salomaothaynara370 → 18.835 views na conta vs 13 somando os posts do SaaS.
--
-- Guardamos por DIA (UTC) para acumular o total além da janela que a API
-- aceita e para permitir recortes (hoje/7d/30d). Validado: a soma de janelas
-- diárias alinhadas à meia-noite UTC é idêntica ao total do período; janelas
-- desalinhadas (ex. meia-noite do Pacífico) contam em dobro.

create table if not exists public.account_views_daily (
  account_id uuid not null references public.instagram_accounts(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  day        date not null,
  views      bigint not null default 0,
  reach      bigint,
  updated_at timestamptz not null default now(),
  primary key (account_id, day)
);

create index if not exists account_views_daily_user_day_idx
  on public.account_views_daily (user_id, day);

alter table public.account_views_daily enable row level security;

drop policy if exists "users_read_own_account_views" on public.account_views_daily;
create policy "users_read_own_account_views" on public.account_views_daily
  for select using (auth.uid() = user_id);

-- Controle do sync por conta (backfill feito + última sincronização).
alter table public.instagram_accounts
  add column if not exists views_backfilled_at timestamptz,
  add column if not exists views_synced_at     timestamptz;

-- Soma para a Dashboard: contas ativas e sem erro. Uma linha, sem teto de 1000.
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
     where user_id = p_user_id and is_active and health_status <> 'error'
  ), v as (
    select d.day, d.views
      from account_views_daily d
      join accs a on a.id = d.account_id
  )
  select jsonb_build_object(
    'total',            coalesce((select sum(views) from v), 0),
    'last_7d',          coalesce((select sum(views) from v where day >= (now() at time zone 'utc')::date - 6), 0),
    'last_30d',         coalesce((select sum(views) from v where day >= (now() at time zone 'utc')::date - 29), 0),
    'accounts_total',   (select count(*) from accs),
    'accounts_synced',  (select count(*) from accs where views_synced_at is not null),
    'last_synced_at',   (select max(views_synced_at) from accs)
  );
$$;

revoke execute on function public.get_account_views_summary(uuid) from public, anon, authenticated;
grant execute on function public.get_account_views_summary(uuid) to service_role;
