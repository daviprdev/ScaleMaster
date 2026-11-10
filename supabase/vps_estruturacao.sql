-- Aba Contas VPS — botão "Estruturar" (kind 'estruturacao') (2026-11-09).
-- Depende de emulador_contas.sql, emulador_atividade.sql e vps_contas.sql.
--
-- Numa conta já criada, a VPS sobe a proxy, abre o Instagram, troca foto e bio,
-- muda para conta profissional, percorre os alvos (perfil → destaque → link →
-- Conectar → Permitir → confirmação), posta o story com link e destaca.
--
-- emulator_jobs.kind ganha 'estruturacao'. As etapas, expandidas por alvo na
-- criação do job, vão em acoes ([{ key, label }]). conta_id liga o job à conta
-- (job nova-conta) e some junto com ela. agendado_para = quando o job pode sair
-- da fila (null = agora).
--
-- Aplicar à mão no Supabase SQL Editor. Idempotente.

alter table public.emulator_jobs add column if not exists conta_id uuid references public.emulator_jobs (id) on delete cascade;
alter table public.emulator_jobs add column if not exists agendado_para timestamptz;

alter table public.emulator_jobs drop constraint if exists emulator_jobs_kind_check;
alter table public.emulator_jobs
  add constraint emulator_jobs_kind_check
  check (kind in ('nova-conta', 'atividade', 'estruturacao'));

create index if not exists emulator_jobs_conta_idx on public.emulator_jobs (conta_id);

notify pgrst, 'reload schema';

select (
  select count(*) = 2 from information_schema.columns
   where table_schema = 'public' and table_name = 'emulator_jobs'
     and column_name in ('conta_id', 'agendado_para')
)
and exists (
  select 1 from pg_constraint
   where conname = 'emulator_jobs_kind_check'
     and pg_get_constraintdef(oid) like '%estruturacao%'
) as vps_estruturacao_ok;
