-- Auditoria 2026-09-12 — fecha RPCs expostas publicamente via /rest/v1/rpc.
--
-- delete_library_folder_cascade e get_campaign_summaries eram SECURITY DEFINER
-- e recebiam p_user_id como PARÂMETRO: qualquer pessoa com a anon key (que é
-- pública, vai no bundle do navegador) podia chamar
--   POST /rest/v1/rpc/delete_library_folder_cascade {p_folder_id, p_user_id}
-- passando o id de outro usuário e apagar a pasta + vídeos dele, ou ler as
-- campanhas de qualquer usuário. Todas as chamadas legítimas saem do servidor
-- com a service_role, então nada no app depende do grant público.
--
-- Funções de trigger (handle_new_user_role, *_updated_at) continuam
-- disparando normalmente: o privilégio EXECUTE não é checado no disparo.

do $$
declare
  fn text;
begin
  foreach fn in array array[
    'public.delete_library_folder_cascade(uuid, uuid)',
    'public.get_campaign_summaries(uuid)',
    'public.get_account_video_usage(uuid[], timestamptz)',
    'public.get_distribute_account_states(uuid, uuid[])',
    'public.handle_new_user_role()',
    'public.set_account_logins_updated_at()',
    'public.set_reader_accounts_updated_at()',
    'public.set_updated_at()',
    'public.update_automations_updated_at()',
    'public.update_human_schedule_updated_at()'
  ] loop
    execute format('revoke execute on function %s from public, anon, authenticated', fn);
    execute format('grant execute on function %s to service_role', fn);
  end loop;
end $$;

-- search_path fixo (lint 0011): evita que um objeto homônimo em outro schema
-- seja resolvido no lugar do esperado.
alter function public.update_human_schedule_updated_at() set search_path = public;
alter function public.set_account_logins_updated_at()    set search_path = public;
alter function public.set_reader_accounts_updated_at()   set search_path = public;
alter function public.update_automations_updated_at()    set search_path = public;
alter function public.get_distribute_account_states(uuid, uuid[]) set search_path = public;
