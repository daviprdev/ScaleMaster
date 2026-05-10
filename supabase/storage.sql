-- ═══════════════════════════════════════════════════════════════
-- NexusSocial — Storage SQL
-- Execute APÓS o schema.sql no Supabase Dashboard → SQL Editor
-- ═══════════════════════════════════════════════════════════════


-- ──────────────────────────────────────────────────────────────
-- 1. Bucket: videos-library
--    Bucket público para servir vídeos processados diretamente
-- ──────────────────────────────────────────────────────────────
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'videos-library',
  'videos-library',
  true,                                    -- URLs públicas sem autenticação
  524288000,                               -- 500 MB por arquivo
  array['video/mp4', 'video/quicktime', 'video/webm']
)
on conflict (id) do nothing;


-- ──────────────────────────────────────────────────────────────
-- 2. Políticas de Storage
-- ──────────────────────────────────────────────────────────────

-- Qualquer pessoa pode ler (necessário para URLs públicas funcionarem)
create policy "public_read_videos"
  on storage.objects for select
  using (bucket_id = 'videos-library');

-- Apenas usuários autenticados podem fazer upload
create policy "auth_upload_videos"
  on storage.objects for insert
  with check (
    bucket_id = 'videos-library'
    and auth.role() = 'authenticated'
  );

-- Usuários só deletam arquivos dentro da sua pasta (videos/<user_id>/...)
-- Nota: o path no Storage deve ser organizado como videos/<user_id>/arquivo.mp4
create policy "users_delete_own_videos"
  on storage.objects for delete
  using (
    bucket_id = 'videos-library'
    and auth.uid()::text = (storage.foldername(name))[2]
  );
