-- Buscas de Inspirações duráveis (2026-09-13).
--
-- Antes, o resultado da busca via Apify só era gravado em scraped_profiles
-- quando a PÁGINA terminava o polling. Sair da página (ou a página desistir
-- após 5 min, comum em perfil com 500+ vídeos) deixava o resultado órfão na
-- Apify — pago e nunca salvo. Agora a busca é registrada no início e o
-- servidor (poll da página OU cron finalize-inspiration-scrapes) a finaliza.

create table if not exists public.inspiration_scrape_searches (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references auth.users(id) on delete cascade,
  username          text not null,
  run_ids           text[] not null default '{}',
  fallback_run_ids  text[] not null default '{}',
  limit_items       integer not null default 500,
  status            text not null default 'running' check (status in ('running', 'done', 'error')),
  reel_count        integer,
  error_message     text,
  -- Claim atômico: página e cron nunca avançam a mesma busca ao mesmo tempo
  -- (evita iniciar o run de fallback — que custa — duas vezes).
  processing_until  timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  finished_at       timestamptz
);

create index if not exists inspiration_scrape_searches_running_idx
  on public.inspiration_scrape_searches (status, updated_at);
create index if not exists inspiration_scrape_searches_user_idx
  on public.inspiration_scrape_searches (user_id, created_at desc);

alter table public.inspiration_scrape_searches enable row level security;

drop policy if exists "users_read_own_scrape_searches" on public.inspiration_scrape_searches;
create policy "users_read_own_scrape_searches" on public.inspiration_scrape_searches
  for select using (auth.uid() = user_id);
