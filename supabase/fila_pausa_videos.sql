-- Aba Fila (2026-10-22) — pausar vídeo da fila. Regras em docs/fila-pausa.md.
--
-- videos_library.queue_paused_at: nulo = vídeo ativo na fila; preenchido =
-- pausado na aba Fila desde essa hora. Vídeo pausado sai do sorteio do Postar
-- (campanha nova e conta que entra pela pasta sincronizada) e do Loop, e o post
-- já agendado com ele cede a vez ao último post pendente da mesma conta na
-- campanha. Reativar (coluna nula de novo) devolve o vídeo à fila.
--
-- Só o servidor grava a coluna (rota /api/fila/videos, service role): o
-- navegador já não tem UPDATE em videos_library (security_hardening_20261017).
--
-- Aplicar à mão no Supabase SQL Editor. Idempotente. O app funciona sem ele:
-- a aba mostra os números e avisa que o botão de pausar depende deste SQL.

alter table public.videos_library
  add column if not exists queue_paused_at timestamptz;

comment on column public.videos_library.queue_paused_at is
  'Pausado na aba Fila desde (NULL = ativo). Vídeo pausado não é sorteado pelo Postar nem pelo Loop.';

-- Os crons leem só os pausados (poucos), a cada rodada.
create index if not exists videos_library_queue_paused_idx
  on public.videos_library (user_id)
  where queue_paused_at is not null;

-- PostgREST passa a enxergar a coluna sem esperar o reload periódico.
notify pgrst, 'reload schema';

select exists (
  select 1 from information_schema.columns
   where table_schema = 'public'
     and table_name = 'videos_library'
     and column_name = 'queue_paused_at'
) as aplicado;
