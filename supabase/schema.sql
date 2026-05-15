-- ═══════════════════════════════════════════════════════════════
-- NexusSocial — Schema SQL
-- Execute este arquivo no Supabase Dashboard → SQL Editor
-- ═══════════════════════════════════════════════════════════════


-- ──────────────────────────────────────────────────────────────
-- 1. Tabela: videos_library
--    Armazena cada vídeo processado e salvo pelo usuário
-- ──────────────────────────────────────────────────────────────
create table if not exists public.videos_library (
  id               uuid        primary key default gen_random_uuid(),
  user_id          uuid        references auth.users(id) on delete cascade,
  filename         text        not null,
  original_url     text,                        -- URL original do Apify
  storage_path     text        not null,         -- Caminho dentro do bucket
  public_url       text        not null,         -- URL pública do Supabase Storage
  file_size        bigint      default 0,        -- Tamanho em bytes
  owner_username   text,                         -- @perfil de origem
  caption          text,                         -- Legenda do Reel original
  views            bigint      default 0,
  likes            bigint      default 0,
  comments         bigint      default 0,
  duration         integer     default 0,        -- Duração em segundos
  created_at       timestamptz default now()
);

-- Índices para queries frequentes
create index if not exists videos_library_user_id_idx
  on public.videos_library(user_id);

create index if not exists videos_library_created_at_idx
  on public.videos_library(created_at desc);


-- ──────────────────────────────────────────────────────────────
-- 2. Row Level Security (RLS)
--    Cada usuário só vê e modifica seus próprios vídeos
-- ──────────────────────────────────────────────────────────────
alter table public.videos_library enable row level security;

-- Leitura: apenas os próprios registros
create policy "users_select_own_videos"
  on public.videos_library for select
  using (auth.uid() = user_id);

-- Inserção: apenas para o próprio user_id
create policy "users_insert_own_videos"
  on public.videos_library for insert
  with check (auth.uid() = user_id);

-- Exclusão: apenas os próprios registros
create policy "users_delete_own_videos"
  on public.videos_library for delete
  using (auth.uid() = user_id);


-- ──────────────────────────────────────────────────────────────
-- 3. Tabela: instagram_accounts
--    Contas do Instagram conectadas pelo usuário
-- ──────────────────────────────────────────────────────────────
create table if not exists public.instagram_accounts (
  id               uuid        primary key default gen_random_uuid(),
  user_id          uuid        not null references auth.users(id) on delete cascade,
  username         text        not null,
  display_name     text,
  avatar_url       text,
  access_token     text,                         -- Criptografar em produção
  is_active        boolean     default true,
  connected_at     timestamptz default now()
);

alter table public.instagram_accounts enable row level security;

create policy "users_manage_own_accounts"
  on public.instagram_accounts for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Fase 25 — Métricas de perfil em tempo real (execute se a tabela já existir)
alter table public.instagram_accounts
  add column if not exists followers_count    integer,
  add column if not exists posts_count        integer,
  add column if not exists last_post_at       timestamptz,
  add column if not exists has_active_stories boolean,   -- reservado; actor atual retorna null
  add column if not exists profile_refreshed_at timestamptz;


-- ──────────────────────────────────────────────────────────────
-- 4. Tabela: scheduled_posts
--    Postagens agendadas (Fase 5)
-- ──────────────────────────────────────────────────────────────
create table if not exists public.scheduled_posts (
  id               uuid        primary key default gen_random_uuid(),
  user_id          uuid        not null references auth.users(id) on delete cascade,
  video_id         uuid        references public.videos_library(id) on delete set null,
  account_id       uuid        references public.instagram_accounts(id) on delete cascade,
  caption          text,
  scheduled_at     timestamptz not null,
  status           text        not null default 'pending'
                               check (status in ('pending', 'published', 'failed', 'cancelled')),
  error_message    text,
  created_at       timestamptz default now()
);

alter table public.scheduled_posts enable row level security;

create policy "users_manage_own_posts"
  on public.scheduled_posts for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);


-- ──────────────────────────────────────────────────────────────
-- 5. Tabela: scraped_profiles
--    Cache de perfis raspados — evita re-scraping ao recarregar
-- ──────────────────────────────────────────────────────────────
create table if not exists public.scraped_profiles (
  id              uuid        primary key default gen_random_uuid(),
  user_id         uuid        not null references auth.users(id) on delete cascade,
  username        text        not null,
  full_name       text        not null default '',
  profile_pic_url text,
  videos_data     jsonb       not null default '[]',
  video_count     integer     not null default 0,
  scraped_at      timestamptz not null default now(),
  constraint uq_scraped_profiles_user_username unique (user_id, username)
);

create index if not exists scraped_profiles_user_id_idx
  on public.scraped_profiles(user_id);

create index if not exists scraped_profiles_scraped_at_idx
  on public.scraped_profiles(scraped_at desc);

alter table public.scraped_profiles enable row level security;

create policy "users_manage_own_scraped_profiles"
  on public.scraped_profiles for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
