-- Aba Emulador — "Criar instância" (fila de contas) e renomear instância
-- (2026-11-01). Depende de emulador_agente.sql.
--
-- emulator_jobs: cada linha é uma conta a criar no MuMu do PC. O agente copia
-- a instância padrão, troca IMEI/Android ID/MAC, dá o @ à cópia, liga,
-- instala o Instagram pelo Aurora, põe a proxy no NekoBox e cria a conta com
-- o Gmail. Roda até duas tarefas por PC em paralelo e conta o andamento em
-- `steps`; se uma etapa falha, a conta fica em 'error' e o botão Continuar
-- devolve para a fila, retomando da etapa que falhou.
--
-- input_enc: proxy e dados da conta (inclui senha) criptografados com
-- ENCRYPTION_SECRET (lib/encrypt.ts). Só o agente recebe aberto, no sync.
-- label: o @ da conta, para a tela.
-- prompt/reply: quando o agente precisa de algo do dono no meio (o código
-- que chegou no Gmail), grava o pedido em prompt; a tela mostra a caixa, a
-- resposta vai para reply e o agente recebe no próximo sync.
--
-- emulator_commands ganha as ações 'rename' (editar o nome da instância no
-- MuMu) e 'delete' (excluir a instância do MuMu, 2026-11-02).
--
-- Tudo passa pelas rotas do servidor (service role): RLS ligada e nenhuma
-- policy. Aplicar à mão no Supabase SQL Editor. Idempotente: pode rodar de
-- novo por cima de uma versão anterior deste arquivo.

create table if not exists public.emulator_jobs (
  id              uuid        primary key default gen_random_uuid(),
  user_id         uuid        not null references auth.users(id) on delete cascade,
  agent_id        uuid        not null references public.emulator_agents(id) on delete cascade,
  kind            text        not null default 'nova-conta' check (kind in ('nova-conta')),
  label           text,
  template_index  integer     not null,
  instance_index  integer,
  input_enc       text        not null,
  steps           jsonb       not null default '[]'::jsonb,
  status          text        not null default 'queued'
                              check (status in ('queued', 'running', 'done', 'error')),
  error           text,
  prompt          text,
  reply           text,
  created_at      timestamptz not null default now(),
  started_at      timestamptz,
  finished_at     timestamptz,
  updated_at      timestamptz not null default now()
);

alter table public.emulator_jobs add column if not exists prompt text;
alter table public.emulator_jobs add column if not exists reply text;

create index if not exists emulator_jobs_agent_status_idx on public.emulator_jobs (agent_id, status);
create index if not exists emulator_jobs_user_created_idx on public.emulator_jobs (user_id, created_at desc);

alter table public.emulator_jobs enable row level security;
revoke all on public.emulator_jobs from anon, authenticated;

alter table public.emulator_commands drop constraint if exists emulator_commands_action_check;
alter table public.emulator_commands
  add constraint emulator_commands_action_check
  check (action in ('launch', 'shutdown', 'task', 'rename', 'delete'));

notify pgrst, 'reload schema';

select (
  select count(*) from information_schema.columns
   where table_schema = 'public' and table_name = 'emulator_jobs'
     and column_name in ('prompt', 'reply')
) = 2
and exists (
  select 1 from pg_constraint
   where conname = 'emulator_commands_action_check'
     and pg_get_constraintdef(oid) like '%rename%'
     and pg_get_constraintdef(oid) like '%delete%'
) as aplicado;
