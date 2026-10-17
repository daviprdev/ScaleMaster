-- Reels publicados por conta, por dia de Brasília (2026-10-17).
--
-- O card "Vídeos Publicados" da Dashboard contava scheduled_posts com status
-- 'published' — registros que somem quando a campanha é excluída com "apagar
-- posts" (medido: excluir uma campanha zerou o card, 103 publicados perdidos).
-- Agora a contagem vem da lista de mídias da própria conta na Meta
-- (GET /{ig-user-id}/media, media_product_type = REELS), gravada aqui pelo
-- cron sync-account-views. Como em account_views_daily, contas EXCLUÍDAS do
-- SaaS levam o histórico junto (on delete cascade).
--
-- Diferente das views, a Meta dá o timestamp exato de cada mídia, então o dia
-- aqui é o de Brasília de verdade (sem a limitação de dia UTC).

create table if not exists public.account_reels_daily (
  account_id uuid not null references public.instagram_accounts(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  day        date not null,
  reels      integer not null default 0,
  updated_at timestamptz not null default now(),
  primary key (account_id, day)
);

create index if not exists account_reels_daily_day_idx
  on public.account_reels_daily (day);

alter table public.account_reels_daily enable row level security;

drop policy if exists "users_read_own_account_reels" on public.account_reels_daily;
create policy "users_read_own_account_reels" on public.account_reels_daily
  for select using (auth.uid() = user_id);

-- Backfill (histórico inteiro de reels) já feito para a conta.
alter table public.instagram_accounts
  add column if not exists reels_backfilled_at timestamptz;

-- Resumo para a Dashboard. Global como as views (soma todas as contas do SaaS,
-- inclusive caídas e desativadas — reel publicado é fato, a conta ter caído
-- depois não muda isso).
create or replace function public.get_reels_summary()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with ref as (
    select (now() at time zone 'America/Sao_Paulo')::date as today
  )
  select jsonb_build_object(
    'total',           coalesce((select sum(reels) from account_reels_daily), 0),
    'today',           coalesce((select sum(reels) from account_reels_daily, ref where day = ref.today), 0),
    'yesterday',       coalesce((select sum(reels) from account_reels_daily, ref where day = ref.today - 1), 0),
    'last_7d',         coalesce((select sum(reels) from account_reels_daily, ref where day >= ref.today - 6 and day <= ref.today), 0),
    'month',           coalesce((select sum(reels) from account_reels_daily, ref
                                  where day >= date_trunc('month', ref.today)::date
                                    and day <= ref.today), 0),
    'accounts_synced', (select count(*) from instagram_accounts where reels_backfilled_at is not null)
  );
$$;

revoke execute on function public.get_reels_summary() from public, anon, authenticated;
grant execute on function public.get_reels_summary() to service_role;
