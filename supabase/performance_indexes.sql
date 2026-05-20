-- ═══════════════════════════════════════════════════════════════
-- Performance indexes — executar no Supabase SQL Editor
-- Cobre todas as FKs e colunas de filtro frequente que não tinham
-- índice explícito no schema original.
-- ═══════════════════════════════════════════════════════════════

-- instagram_accounts
create index if not exists instagram_accounts_user_id_idx
  on public.instagram_accounts(user_id);

create index if not exists instagram_accounts_is_active_idx
  on public.instagram_accounts(is_active)
  where is_active = true;

create index if not exists instagram_accounts_ig_business_account_id_idx
  on public.instagram_accounts(ig_business_account_id)
  where ig_business_account_id is not null;

create index if not exists instagram_accounts_token_expires_at_idx
  on public.instagram_accounts(token_expires_at)
  where token_expires_at is not null;

-- scheduled_posts
create index if not exists scheduled_posts_user_id_idx
  on public.scheduled_posts(user_id);

create index if not exists scheduled_posts_account_id_idx
  on public.scheduled_posts(account_id);

-- loops
create index if not exists loops_user_id_idx
  on public.loops(user_id);

create index if not exists loops_status_idx
  on public.loops(status)
  where status = 'active';

-- loop_accounts
create index if not exists loop_accounts_loop_id_idx
  on public.loop_accounts(loop_id);

create index if not exists loop_accounts_account_id_idx
  on public.loop_accounts(account_id);

-- single_posts
create index if not exists single_posts_user_id_idx
  on public.single_posts(user_id);

create index if not exists single_posts_status_idx
  on public.single_posts(status)
  where status in ('pending', 'publishing');

create index if not exists single_posts_scheduled_for_idx
  on public.single_posts(scheduled_for)
  where scheduled_for is not null and status = 'pending';

-- single_post_accounts
create index if not exists single_post_accounts_post_id_idx
  on public.single_post_accounts(post_id);

create index if not exists single_post_accounts_account_id_idx
  on public.single_post_accounts(account_id);

-- videos_library — folder_id (pode já existir via library_folders.sql)
create index if not exists videos_library_folder_id_idx
  on public.videos_library(folder_id);

-- user_meta_apps — já coberto em user_meta_apps.sql mas garantido aqui
create index if not exists user_meta_apps_user_id_idx
  on public.user_meta_apps(user_id);
