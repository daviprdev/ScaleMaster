-- Pastas da aba Contas VPS (12/11/2026): cada conta (emulator_jobs kind 'nova-conta')
-- pode ficar numa pasta, escolhida ou criada no "Enviar lote" e trocada no card.
-- "Estruturar pasta" cria uma estruturação para cada conta criada da pasta.
-- Sem pasta = null ("Sem pasta" na tela). Idempotente.

alter table public.emulator_jobs add column if not exists pasta text;

create index if not exists emulator_jobs_user_pasta_idx
  on public.emulator_jobs (user_id, pasta)
  where pasta is not null;

notify pgrst, 'reload schema';
