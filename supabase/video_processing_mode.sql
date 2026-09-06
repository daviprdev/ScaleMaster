-- ─────────────────────────────────────────────────────────────────────────────
-- Processamento de vídeo opt-in por publicação  (aplicado em 2026-09-06)
--
-- 1. video_processing_mode nas entidades de CONFIGURAÇÃO (loops, automations,
--    distribute_campaigns, story_templates) e nas entidades de POSTAGEM CONCRETA
--    (scheduled_posts, pending_containers). A decisão é copiada da configuração
--    para o post no momento do agendamento — mudar a config depois NÃO altera
--    retroativamente posts já agendados.
--
-- 2. video_variants: variantes derivadas do arquivo ORIGINAL. O original em
--    videos_library nunca é sobrescrito. Dedup por (source_hash, mode, version).
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.loops
  add column if not exists video_processing_mode text not null default 'original';
alter table public.automations
  add column if not exists video_processing_mode text not null default 'original';
alter table public.distribute_campaigns
  add column if not exists video_processing_mode text not null default 'original';
alter table public.story_templates
  add column if not exists video_processing_mode text not null default 'original';
alter table public.scheduled_posts
  add column if not exists video_processing_mode text not null default 'original';
alter table public.pending_containers
  add column if not exists video_processing_mode text not null default 'original';

do $$
declare t text;
begin
  foreach t in array array[
    'loops','automations','distribute_campaigns','story_templates',
    'scheduled_posts','pending_containers'
  ] loop
    execute format(
      'alter table public.%I drop constraint if exists %I',
      t, t || '_video_processing_mode_check'
    );
    execute format(
      'alter table public.%I add constraint %I check (video_processing_mode in (''original'',''clean_metadata''))',
      t, t || '_video_processing_mode_check'
    );
  end loop;
end $$;

create table if not exists public.video_variants (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid references auth.users(id) on delete cascade,
  source_video_id    uuid references public.videos_library(id) on delete set null,
  source_url         text not null,
  source_hash        text not null,
  processing_mode    text not null check (processing_mode in ('clean_metadata')),
  processing_version integer not null default 1,
  status             text not null default 'queued'
                       check (status in ('queued','processing','ready','error')),
  storage_path       text,
  public_url         text,
  file_size          bigint,
  error_reason       text,
  attempts           integer not null default 0,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  ready_at           timestamptz,
  last_used_at       timestamptz not null default now()
);

create unique index if not exists video_variants_dedup_idx
  on public.video_variants (source_hash, processing_mode, processing_version);
create index if not exists video_variants_status_idx
  on public.video_variants (status, created_at);
create index if not exists video_variants_source_video_idx
  on public.video_variants (source_video_id);

alter table public.video_variants enable row level security;

drop policy if exists "users_manage_own_video_variants" on public.video_variants;
create policy "users_manage_own_video_variants" on public.video_variants
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
