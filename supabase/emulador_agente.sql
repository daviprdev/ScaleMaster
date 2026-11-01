-- Aba Emulador (2026-11-01) — agente do MuMu no PC do dono.
--
-- O SaaS roda na VPS e não enxerga o PC. Um agente (pasta agente-mumu/, Node
-- sem dependências) roda no PC, fala com o MuMuManager e chama
-- /api/emulador/agente/sync a cada poucos segundos: manda o retrato das
-- instâncias e o resultado dos comandos, e recebe os comandos novos.
--
-- emulator_agents: um PC conectado. O código do agente só aparece uma vez na
--   tela; aqui fica o sha256 dele. instances/tasks = último retrato enviado.
-- emulator_commands: o que a tela pediu (abrir, fechar, rodar automação) e o
--   que o agente respondeu.
--
-- Tudo passa pelas rotas do servidor (service role). O navegador não lê nem
-- grava estas tabelas direto: RLS ligada e nenhuma policy.
--
-- Aplicar à mão no Supabase SQL Editor. Idempotente. Sem ele a aba só avisa
-- que falta este SQL.

create table if not exists public.emulator_agents (
  id             uuid        primary key default gen_random_uuid(),
  user_id        uuid        not null references auth.users(id) on delete cascade,
  token_hash     text        not null unique,
  hostname       text,
  agent_version  text,
  mumu_version   text,
  mumu_error     text,
  instances      jsonb       not null default '[]'::jsonb,
  tasks          jsonb       not null default '[]'::jsonb,
  last_seen_at   timestamptz,
  created_at     timestamptz not null default now()
);

create index if not exists emulator_agents_user_idx on public.emulator_agents (user_id);

create table if not exists public.emulator_commands (
  id              uuid        primary key default gen_random_uuid(),
  user_id         uuid        not null references auth.users(id) on delete cascade,
  agent_id        uuid        not null references public.emulator_agents(id) on delete cascade,
  instance_index  integer     not null,
  action          text        not null check (action in ('launch', 'shutdown', 'task')),
  task            text,
  params          jsonb       not null default '{}'::jsonb,
  status          text        not null default 'queued'
                              check (status in ('queued', 'running', 'done', 'error')),
  result          jsonb,
  error           text,
  created_at      timestamptz not null default now(),
  started_at      timestamptz,
  finished_at     timestamptz
);

create index if not exists emulator_commands_agent_status_idx
  on public.emulator_commands (agent_id, status);
create index if not exists emulator_commands_user_created_idx
  on public.emulator_commands (user_id, created_at desc);

alter table public.emulator_agents   enable row level security;
alter table public.emulator_commands enable row level security;

revoke all on public.emulator_agents   from anon, authenticated;
revoke all on public.emulator_commands from anon, authenticated;

notify pgrst, 'reload schema';

select (
  select count(*) from information_schema.tables
   where table_schema = 'public'
     and table_name in ('emulator_agents', 'emulator_commands')
) = 2 as aplicado;
