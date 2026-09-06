-- ─────────────────────────────────────────────────────────────────────────────
-- Exclusão segura de pasta da Biblioteca. Aplicada em 2026-09-06.
--
-- As FKs já estavam corretas em produção (verificado antes de qualquer
-- alteração) — nenhuma precisou ser mexida:
--   videos_library.folder_id             -> library_folders(id) ON DELETE SET NULL
--   loops.folder_id                      -> library_folders(id) ON DELETE SET NULL
--   automation_video_folders.folder_id   -> library_folders(id) ON DELETE CASCADE
--   distribute_campaigns.video_folder_id -> library_folders(id) ON DELETE CASCADE
--
-- Ou seja: nenhuma FK bloqueava o DELETE. O que faltava era registrar POR QUE
-- um Loop foi pausado quando a pasta de mídia dele deixa de existir — sem isso
-- ele ficaria "ativo" apontando para folder_id = NULL e falhando em silêncio.
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.loops
  add column if not exists paused_reason text;

comment on column public.loops.paused_reason is
  'Motivo legível de uma pausa automática (ex.: pasta de mídia removida). NULL quando o loop foi pausado manualmente ou está ativo.';

-- ─────────────────────────────────────────────────────────────────────────────
-- delete_library_folder_safe: exclusão da pasta em UMA transação.
--
-- Antes eram duas chamadas independentes do PostgREST (UPDATE loops → DELETE
-- folder). Se a segunda falhasse, os Loops ficavam pausados com um motivo
-- mentiroso ("pasta removida") e a pasta continuava lá.
--
-- Uma função plpgsql roda inteiramente dentro de uma transação: exceção em
-- qualquer etapa desfaz tudo (ROLLBACK automático). Comprovado em teste com
-- trigger de falha proposital no DELETE.
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.delete_library_folder_safe(
  p_folder_id uuid,
  p_user_id   uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name      text;
  v_videos    integer;
  v_campaigns integer;
  v_paused    text[];
begin
  -- 1. Ownership: a pasta precisa existir E pertencer a quem pediu.
  select name into v_name
    from library_folders
   where id = p_folder_id and user_id = p_user_id;

  if v_name is null then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  -- 2. Métricas coletadas antes das mutações.
  select count(*) into v_videos
    from videos_library where folder_id = p_folder_id;

  select count(*) into v_campaigns
    from distribute_campaigns where video_folder_id = p_folder_id;

  -- 3. Loops ativos que dependiam da pasta: pausa com motivo legível.
  with upd as (
    update loops
       set status = 'paused',
           paused_reason = format('Pasta de mídia "%s" foi removida.', v_name)
     where folder_id = p_folder_id
       and user_id = p_user_id
       and status = 'active'
    returning name
  )
  select coalesce(array_agg(name), '{}') into v_paused from upd;

  -- 4. DELETE da pasta. As FKs cuidam do resto:
  --    videos_library.folder_id -> NULL | distribute_campaigns -> CASCADE
  delete from library_folders
   where id = p_folder_id and user_id = p_user_id;

  return jsonb_build_object(
    'ok', true,
    'folder_name', v_name,
    'videos_moved', v_videos,
    'paused_loops', to_jsonb(v_paused),
    'synced_campaigns_removed', v_campaigns
  );
end;
$$;

-- A função é chamada pela rota com a service role. Um usuário autenticado não
-- pode invocá-la passando o user_id de outra pessoa.
revoke all on function public.delete_library_folder_safe(uuid, uuid) from public;
revoke all on function public.delete_library_folder_safe(uuid, uuid) from anon;
revoke all on function public.delete_library_folder_safe(uuid, uuid) from authenticated;
grant execute on function public.delete_library_folder_safe(uuid, uuid) to service_role;
