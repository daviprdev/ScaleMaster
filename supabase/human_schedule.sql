-- ═══════════════════════════════════════════════════════════════
-- Fase: Horário Humano — executar no Supabase SQL Editor
-- ═══════════════════════════════════════════════════════════════

create table if not exists public.human_schedule_settings (
  user_id    uuid        primary key references auth.users(id) on delete cascade,
  is_active  boolean     not null default false,
  start_time time        not null default '07:00',
  end_time   time        not null default '23:00',
  timezone   text        not null default 'America/Sao_Paulo',
  updated_at timestamptz not null default now()
);

alter table public.human_schedule_settings enable row level security;

create policy "users_manage_own_schedule"
  on public.human_schedule_settings for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Trigger para atualizar updated_at automaticamente
create or replace function public.update_human_schedule_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists human_schedule_updated_at on public.human_schedule_settings;
create trigger human_schedule_updated_at
  before update on public.human_schedule_settings
  for each row execute procedure public.update_human_schedule_updated_at();
