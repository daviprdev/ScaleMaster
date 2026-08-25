-- ═══════════════════════════════════════════════════════════════
-- Notificações Push (Web Push) — executar no Supabase SQL Editor
-- ═══════════════════════════════════════════════════════════════

-- 1. Inscrições push por usuário/dispositivo
create table if not exists public.push_subscriptions (
  id            uuid        primary key default gen_random_uuid(),
  user_id       uuid        not null references auth.users(id) on delete cascade,
  endpoint      text        not null unique,
  p256dh        text        not null,
  auth          text        not null,
  user_agent    text,
  created_at    timestamptz not null default now(),
  last_seen_at  timestamptz not null default now()
);

create index if not exists push_subscriptions_user_id_idx on public.push_subscriptions(user_id);

alter table public.push_subscriptions enable row level security;

create policy "users_manage_own_push_subscriptions"
  on public.push_subscriptions for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- 2. Log/auditoria de envios
create table if not exists public.notifications (
  id              uuid        primary key default gen_random_uuid(),
  target_type     text        not null check (target_type in ('all', 'admins', 'user')),
  target_user_id  uuid        references auth.users(id) on delete set null,
  type            text        not null check (type in ('admin', 'system', 'sale')),
  title           text        not null,
  body            text        not null,
  data            jsonb       not null default '{}'::jsonb,
  created_by      uuid        references auth.users(id) on delete set null,
  sent_count      int         not null default 0,
  failed_count    int         not null default 0,
  created_at      timestamptz not null default now()
);

create index if not exists notifications_created_at_idx on public.notifications(created_at desc);
create index if not exists notifications_type_idx on public.notifications(type);

alter table public.notifications enable row level security;

-- Somente admins leem o histórico; toda escrita é feita via service_role
-- (rotas /api/admin/notifications, /api/cron/daily-profit-notification, /api/webhooks/apexvips).
create policy "admins_select_notifications"
  on public.notifications for select
  using (
    exists (
      select 1 from public.user_roles ur
      where ur.user_id = auth.uid() and ur.role = 'admin'
    )
  );

-- 3. Vendas (ApexVips) — negócio do dono do SaaS, não dos usuários finais
create table if not exists public.sales (
  id                   uuid        primary key default gen_random_uuid(),
  external_id          text,       -- transaction.sale_code da ApexVips, dedup de reenvio de webhook
  amount               numeric(12,2),
  currency             text        not null default 'BRL',
  source               text        not null default 'apexvips',
  customer_identifier  text,
  raw_payload          jsonb       not null default '{}'::jsonb,
  created_at           timestamptz not null default now()
);

create index if not exists sales_created_at_idx on public.sales(created_at);
-- Índice único NÃO parcial: Postgres permite múltiplos NULL em coluna única,
-- e o upsert (ON CONFLICT) do PostgREST não infere índice único parcial.
create unique index if not exists sales_external_id_unique_idx on public.sales(external_id);

alter table public.sales enable row level security;

create policy "admins_select_sales"
  on public.sales for select
  using (
    exists (
      select 1 from public.user_roles ur
      where ur.user_id = auth.uid() and ur.role = 'admin'
    )
  );
-- Nenhuma policy de insert/update/delete: apenas o webhook (service_role) grava.
