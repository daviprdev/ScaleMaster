-- Aba Contas VPS (2026-11-06) — contas do Instagram criadas em containers
-- redroid numa VPS (agente-vps/), sem emulador de tela.
--
-- O agente da VPS usa o MESMO sync do agente do MuMu
-- (/api/emulador/agente/sync, código smag_, comandos e fila emulator_jobs).
-- O que separa as duas abas é emulator_agents.kind: 'mumu' (PC do dono) ou
-- 'vps'. A aba Emulador lista só os 'mumu'; a aba Contas VPS, só os 'vps'.
--
-- emulator_agents.capacidade: o que a VPS informa no sync — quantos
--   containers ligados cabem na RAM (maxLigadas = RAM_MB / 1400) e quantos
--   cadastros rodam ao mesmo tempo (maxCadastro = max(2, vCPU / 2)), RAM usada.
-- emulator_jobs.lote_id: as contas enviadas juntas (1 a 20 por envio).
-- emulator_jobs.pausa: 'proxy' = o dono pausou a conta por proxy morta (não
--   entra na fila até trocar a proxy e continuar).
-- emulator_jobs.versao_ig: APK pinado do Instagram que a conta usa
--   (/opt/scalemaster/apks/instagram-<versao>.apk na VPS).
--
-- vps_devices: identidade imutável de cada conta/container (gerada no
--   servidor ao enviar o lote; o agente aplica no boot e confere por getprop):
--   android_id, serial, MAC, modelo, fabricante, fingerprint, resolução,
--   fuso e idioma. container = nome planejado (ig-<índice>), volume = o volume
--   Docker de 4 GB. status: criado → proxy-ok / proxy-morta → ativo.
--
-- Tudo passa pelas rotas do servidor (service role): RLS ligada e nenhuma
-- policy. Aplicar à mão no Supabase SQL Editor. Idempotente: pode rodar
-- duas vezes sem erro. Depende de emulador_agente.sql, emulador_contas.sql e
-- emulador_atividade.sql.

alter table public.emulator_agents add column if not exists kind text not null default 'mumu';
alter table public.emulator_agents add column if not exists capacidade jsonb not null default '{}'::jsonb;
alter table public.emulator_jobs   add column if not exists lote_id uuid;
alter table public.emulator_jobs   add column if not exists pausa text;
alter table public.emulator_jobs   add column if not exists versao_ig text;

alter table public.emulator_agents drop constraint if exists emulator_agents_kind_check;
alter table public.emulator_agents
  add constraint emulator_agents_kind_check
  check (kind in ('mumu', 'vps'));

alter table public.emulator_jobs drop constraint if exists emulator_jobs_pausa_check;
alter table public.emulator_jobs
  add constraint emulator_jobs_pausa_check
  check (pausa is null or pausa in ('proxy'));

create table if not exists public.vps_devices (
  id           uuid        primary key default gen_random_uuid(),
  user_id      uuid        not null references auth.users(id) on delete cascade,
  job_id       uuid        not null unique references public.emulator_jobs(id) on delete cascade,
  android_id   text        not null,
  serial       text        not null,
  mac          text        not null,
  model        text        not null,
  manufacturer text        not null,
  fingerprint  text        not null,
  resolucao    text        not null,
  timezone     text        not null,
  locale       text        not null,
  container    text        not null unique,
  volume       text        not null,
  status       text        not null default 'criado'
                           check (status in ('criado', 'proxy-ok', 'proxy-morta', 'ativo')),
  created_at   timestamptz not null default now()
);

-- Created do container no Docker (string crua do inspect), gravado pelo agente
-- na etapa copiar: o Remover confere contra ele antes de apagar o container.
alter table public.vps_devices add column if not exists docker_created text;

-- 2026-11-08: conta descartada (captcha ou @ recusado 5 vezes: container e
-- volume já apagados pelo agente) e o @ que o Instagram aceitou.
alter table public.vps_devices drop constraint if exists vps_devices_status_check;
alter table public.vps_devices
  add constraint vps_devices_status_check
  check (status in ('criado', 'proxy-ok', 'proxy-morta', 'ativo', 'descartada'));
alter table public.vps_devices add column if not exists usuario text;

create index if not exists emulator_agents_kind_idx        on public.emulator_agents (user_id, kind);
create index if not exists emulator_jobs_agent_status_idx  on public.emulator_jobs (agent_id, status);
create index if not exists emulator_jobs_user_created_idx  on public.emulator_jobs (user_id, created_at desc);
create index if not exists emulator_jobs_lote_idx          on public.emulator_jobs (lote_id);
create index if not exists vps_devices_user_created_idx    on public.vps_devices (user_id, created_at desc);

alter table public.vps_devices enable row level security;
revoke all on public.vps_devices from anon, authenticated;

notify pgrst, 'reload schema';

select (
  select count(*) from information_schema.columns
   where table_schema = 'public' and table_name = 'emulator_agents'
     and column_name in ('kind', 'capacidade')
) = 2
and (
  select count(*) from information_schema.columns
   where table_schema = 'public' and table_name = 'emulator_jobs'
     and column_name in ('lote_id', 'pausa', 'versao_ig')
) = 3
and exists (
  select 1 from information_schema.columns
   where table_schema = 'public' and table_name = 'vps_devices' and column_name = 'docker_created'
)
and exists (
  select 1 from pg_constraint
   where conname = 'emulator_agents_kind_check'
     and pg_get_constraintdef(oid) like '%vps%'
) as aplicado;
