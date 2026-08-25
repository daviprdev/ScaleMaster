-- ═══════════════════════════════════════════════════════════════
-- Configurações de alertas por usuário — executar no Supabase SQL Editor
-- ═══════════════════════════════════════════════════════════════

create table if not exists public.notification_settings (
  user_id                uuid        primary key references auth.users(id) on delete cascade,
  proxy_alerts_enabled   boolean     not null default true,
  account_alerts_enabled boolean     not null default true,
  daily_profit_enabled   boolean     not null default false,
  daily_profit_time      text        not null default '23:55', -- HH:mm em America/Sao_Paulo
  updated_at             timestamptz not null default now()
);

alter table public.notification_settings enable row level security;

create policy "users_manage_own_notification_settings"
  on public.notification_settings for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
