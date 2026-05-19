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

-- Fase 27 — Meta Graph API OAuth (execute se a tabela já existir)
-- Abandona credenciais instagrapi e adota tokens OAuth oficiais
alter table public.instagram_accounts
  add column if not exists meta_access_token      text,        -- Long-lived User Access Token (~60 dias)
  add column if not exists ig_business_account_id text,        -- ID da conta IG Business ou Creator
  add column if not exists fb_page_id             text,        -- ID da Página do Facebook vinculada
  add column if not exists token_expires_at       timestamptz; -- Data de expiração do token


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

-- Fase 26 — Agendamento em Massa (execute se a tabela já existir)
alter table public.scheduled_posts
  add column if not exists video_url text;

-- Fase 30 — Executor de Posts Agendados (execute se a tabela já existir)
-- Adiciona status 'publishing' para travamento atômico anti-duplicata
do $$
begin
  alter table public.scheduled_posts
    drop constraint if exists scheduled_posts_status_check;
  alter table public.scheduled_posts
    add constraint scheduled_posts_status_check
    check (status in ('pending', 'publishing', 'published', 'failed', 'cancelled'));
exception when others then null;
end $$;

alter table public.scheduled_posts
  add column if not exists published_at  timestamptz,
  add column if not exists media_id      text;

-- Índice parcial: acelera a query do cron (apenas linhas pendentes/em publicação)
create index if not exists scheduled_posts_cron_idx
  on public.scheduled_posts(scheduled_at)
  where status in ('pending', 'publishing');


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


-- ──────────────────────────────────────────────────────────────
-- 6. Tabela: user_roles
--    Controle de permissões por usuário (user | admin | banned)
--    Criada automaticamente via trigger ao registrar novo usuário
-- ──────────────────────────────────────────────────────────────
create table if not exists public.user_roles (
  id         uuid        primary key default gen_random_uuid(),
  user_id    uuid        not null references auth.users(id) on delete cascade,
  role       text        not null default 'user'
                         check (role in ('user', 'admin', 'banned')),
  created_at timestamptz default now(),
  constraint uq_user_roles_user_id unique (user_id)
);

alter table public.user_roles enable row level security;

-- Usuários só leem o próprio role; escrita apenas pelo service_role
create policy "users_read_own_role"
  on public.user_roles for select
  using (auth.uid() = user_id);

-- Trigger: insere role 'user' automaticamente ao criar conta
create or replace function public.handle_new_user_role()
returns trigger language plpgsql security definer as $$
begin
  insert into public.user_roles (user_id, role)
  values (new.id, 'user')
  on conflict (user_id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created_role on auth.users;
create trigger on_auth_user_created_role
  after insert on auth.users
  for each row execute procedure public.handle_new_user_role();


-- ──────────────────────────────────────────────────────────────
-- Para promover um usuário a admin, execute:
--   update public.user_roles set role = 'admin' where user_id = '<uuid>';
-- ──────────────────────────────────────────────────────────────
