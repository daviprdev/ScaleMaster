-- Aba Emulador — botão "Estruturar" (no banco, kind 'atividade') (2026-11-01).
-- Depende de emulador_contas.sql.
--
-- A fila emulator_jobs ganha o tipo 'atividade': numa instância que já tem
-- conta, o agente liga, conecta a proxy do NekoBox, abre o Instagram e faz o
-- que o dono marcou — aquecer (seguir 2–3 verificados e rolar Reels), trocar a
-- foto de perfil e postar story com sticker de link e destacar — e desliga.
-- Divide a fila com Criar instância: uma coisa por vez por PC.
--
-- acoes: o que foi marcado (["aquecer","foto","story"]), aberto para a tela
-- montar as etapas. Link, textos e as mídias marcadas vão em input_enc.
--
-- emulator_agents.media: fotos e vídeos da pasta do MuMu no PC
-- (Documentos/MuMuSharedFolder) que o agente lista — { root, files: [{ path, size, tipo }] }.
-- A janela Estruturar escolhe daí e o agente copia o arquivo direto do PC para
-- a instância (nada sobe para o Storage). Versão 2 deste arquivo: rodar de novo.
--
-- Aplicar à mão no Supabase SQL Editor. Idempotente.

alter table public.emulator_jobs add column if not exists acoes jsonb not null default '[]'::jsonb;
alter table public.emulator_agents add column if not exists media jsonb not null default '{}'::jsonb;

alter table public.emulator_jobs drop constraint if exists emulator_jobs_kind_check;
alter table public.emulator_jobs
  add constraint emulator_jobs_kind_check
  check (kind in ('nova-conta', 'atividade'));

notify pgrst, 'reload schema';

select exists (
  select 1 from information_schema.columns
   where table_schema = 'public' and table_name = 'emulator_jobs' and column_name = 'acoes'
)
and exists (
  select 1 from information_schema.columns
   where table_schema = 'public' and table_name = 'emulator_agents' and column_name = 'media'
)
and exists (
  select 1 from pg_constraint
   where conname = 'emulator_jobs_kind_check'
     and pg_get_constraintdef(oid) like '%atividade%'
) as aplicado;
