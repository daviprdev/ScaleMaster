-- Aba Emulador — fila de "Nova conta" (2026-11-01). Depende de emulador_agente.sql.
--
-- Cada linha é uma conta a criar no MuMu do PC: o agente copia a instância
-- padrão, troca o IMEI, dá o nome da conta à cópia, liga, e segue as etapas
-- seguintes (proxy no NekoBox, Instagram, cadastro) conforme forem
-- automatizadas. O agente roda uma conta por vez e conta o andamento etapa a
-- etapa em `steps`; se uma etapa falha, a conta fica em 'error' e o botão
-- Continuar devolve para a fila, retomando da etapa que falhou.
--
-- input_enc: proxy e dados da conta (inclui senha) criptografados com
-- ENCRYPTION_SECRET (lib/encrypt.ts). Só o agente recebe aberto, no sync.
-- label: o @ da conta, para a tela.
--
-- Tudo passa pelas rotas do servidor (service role): RLS ligada e nenhuma
-- policy. Aplicar à mão no Supabase SQL Editor. Idempotente.

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
  created_at      timestamptz not null default now(),
  started_at      timestamptz,
  finished_at     timestamptz,
  updated_at      timestamptz not null default now()
);

create index if not exists emulator_jobs_agent_status_idx on public.emulator_jobs (agent_id, status);
create index if not exists emulator_jobs_user_created_idx on public.emulator_jobs (user_id, created_at desc);

alter table public.emulator_jobs enable row level security;
revoke all on public.emulator_jobs from anon, authenticated;

notify pgrst, 'reload schema';

select exists (
  select 1 from information_schema.tables
   where table_schema = 'public' and table_name = 'emulator_jobs'
) as aplicado;
