-- Endurecimento de segurança (auditoria 2026-10-17).
--
-- 1. Tabelas que o navegador NÃO precisa escrever ficam só-leitura para os
--    papéis do PostgREST (anon/authenticated). As políticas de RLS só checavam
--    `auth.uid() = user_id` — qualquer usuário logado (inclusive pendente, que
--    tem JWT mas é barrado só pelo middleware do Next) podia, pela API pública:
--      - inserir scheduled_posts / loop_accounts / story_template_accounts com
--        o account_id de OUTRA pessoa → o cron publicava na conta dela;
--      - inserir videos_library com storage_path de arquivo alheio → as rotas
--        de exclusão (service role) apagavam o arquivo do outro usuário.
--    Todas as escritas legítimas dessas tabelas usam a service role (rotas da
--    API e crons), que ignora estes GRANTs.
-- 2. scheduled_posts: a tela de Agendamentos só cancela/re-tenta (status,
--    error_message) e apaga. Fica só isso — nada de inserir nem trocar conta.
-- 3. Storage: upload no bucket videos-library só para usuário APROVADO (ou
--    admin); buckets legados do onboarding (sem uso no app) deixam de aceitar
--    upload do navegador e ganham limite de tamanho/tipo.
--
-- Idempotente.

-- ── 1. Só leitura para o navegador ──────────────────────────────────────────
revoke insert, update, delete on public.videos_library          from anon, authenticated;
revoke insert, update, delete on public.loop_accounts           from anon, authenticated;
revoke insert, update, delete on public.story_template_accounts from anon, authenticated;
revoke insert, update, delete on public.story_media             from anon, authenticated;

-- ── 2. scheduled_posts: só status/error_message e exclusão dos próprios ─────
revoke insert, update on public.scheduled_posts from anon, authenticated;
revoke delete         on public.scheduled_posts from anon;
grant update (status, error_message) on public.scheduled_posts to authenticated;

-- ── 3. Storage ──────────────────────────────────────────────────────────────
-- Aprovado = admin ou account_status 'approved' (e não banido).
create or replace function public.is_approved_user()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from user_roles
     where user_id = auth.uid()
       and role <> 'banned'
       and (role = 'admin' or account_status = 'approved')
  );
$$;
revoke execute on function public.is_approved_user() from public, anon;
grant execute on function public.is_approved_user() to authenticated;

drop policy if exists "auth_upload_videos" on storage.objects;
create policy "auth_upload_videos" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'videos-library' and public.is_approved_user());

-- Listagem do bucket: era SELECT para {public} → qualquer um com a anon key
-- listava todos os caminhos (e user IDs). O link público dos arquivos não
-- depende desta policy (bucket público). Fica só para aprovado — o upsert da
-- foto de perfil (Contas) precisa de SELECT.
drop policy if exists "public_read_videos" on storage.objects;
create policy "public_read_videos" on storage.objects
  for select to authenticated
  using (bucket_id = 'videos-library' and public.is_approved_user());

-- onboarding-media: legado do worker RPA, nenhum código atual sobe/lê por aqui.
drop policy if exists "media_storage_upload 1yw950y_0" on storage.objects;
drop policy if exists "media_storage_read 1yw950y_0"   on storage.objects;

-- Buckets públicos sem limite → só mídia comum e até 50 MB.
update storage.buckets
   set file_size_limit = 52428800,
       allowed_mime_types = array['image/jpeg','image/png','image/webp','video/mp4','video/quicktime']
 where id in ('onboarding', 'onboarding-media', 'videos');
