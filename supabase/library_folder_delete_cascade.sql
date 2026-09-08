-- Exclusão TOTAL de pasta (2026-09-08) — decisão do dono.
-- Substitui a semântica de `delete_library_folder_safe` (mover para "Sem pasta").
-- Agora excluir a pasta apaga a pasta E todos os vídeos dentro dela: linhas de
-- videos_library + devolve os storage_paths para a rota remover os arquivos do
-- Storage. Tudo numa transação plpgsql — falhou um passo, nada é aplicado.
create or replace function public.delete_library_folder_cascade(
  p_folder_id uuid,
  p_user_id   uuid
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_name      text;
  v_paths     text[];
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

  -- 2. Coleta storage_paths (para o Storage) e contagem ANTES de apagar.
  --    'direct/' = URL externa sem arquivo no Storage → excluída da lista.
  select
    coalesce(array_agg(storage_path) filter (
      where storage_path is not null and storage_path not like 'direct/%'
    ), '{}'),
    count(*)
  into v_paths, v_videos
  from videos_library
  where folder_id = p_folder_id and user_id = p_user_id;

  select count(*) into v_campaigns
    from distribute_campaigns where video_folder_id = p_folder_id;

  -- 3. Loops ativos que dependiam da pasta: pausa com motivo legível.
  with upd as (
    update loops
       set status = 'paused',
           paused_reason = format('Pasta de mídia "%s" foi excluída (com os vídeos).', v_name)
     where folder_id = p_folder_id
       and user_id = p_user_id
       and status = 'active'
    returning name
  )
  select coalesce(array_agg(name), '{}') into v_paused from upd;

  -- 4. Apaga os VÍDEOS da pasta. As FKs cuidam dos filhos:
  --    scheduled_posts/pending_containers/video_variants -> SET NULL
  --    video_processing_jobs -> CASCADE
  delete from videos_library
   where folder_id = p_folder_id and user_id = p_user_id;

  -- 5. Apaga a pasta. distribute_campaigns/automation_video_folders -> CASCADE
  --    loops.folder_id -> SET NULL (já pausados acima).
  delete from library_folders
   where id = p_folder_id and user_id = p_user_id;

  return jsonb_build_object(
    'ok', true,
    'folder_name', v_name,
    'videos_deleted', v_videos,
    'storage_paths', to_jsonb(v_paths),
    'paused_loops', to_jsonb(v_paused),
    'synced_campaigns_removed', v_campaigns
  );
end;
$function$;

revoke all on function public.delete_library_folder_cascade(uuid, uuid) from anon, authenticated;
grant execute on function public.delete_library_folder_cascade(uuid, uuid) to service_role;
