-- Views Totais da Dashboard (2026-09-13).
--
-- Soma views de TODAS as origens de postagem, só de contas ativas e sem erro:
--   scheduled_posts    → Postar / Clonar / Stories
--   pending_containers → Loop
-- Antes a Dashboard lia apenas scheduled_posts, e ainda em JS: os posts do Loop
-- (a maioria) nunca entravam no total, e o PostgREST cortaria a soma em 1000
-- linhas quando o volume crescesse. A agregação no banco devolve UMA linha.
--
-- SECURITY DEFINER com p_user_id como parâmetro → EXECUTE só para service_role
-- (a rota chama com o id do usuário autenticado). Ver revoke_public_rpc_execute.sql.

create or replace function public.get_views_summary(p_user_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with posts as (
    select sp.insights_plays as plays, sp.insights_fetched_at as fetched_at, 'posts' as src
      from scheduled_posts sp
      join instagram_accounts a on a.id = sp.account_id
     where sp.user_id = p_user_id
       and sp.status = 'published'
       and a.is_active
       and a.health_status <> 'error'
    union all
    select pc.insights_plays, pc.insights_fetched_at, 'loop'
      from pending_containers pc
      join instagram_accounts a on a.id = pc.account_id
     where pc.user_id = p_user_id
       and pc.status = 'published'
       and a.is_active
       and a.health_status <> 'error'
  )
  select jsonb_build_object(
    'total',          coalesce(sum(plays), 0),
    'tracked_posts',  count(plays),
    'total_posts',    count(*),
    'last_synced_at', max(fetched_at),
    'loop_total',     coalesce(sum(plays) filter (where src = 'loop'), 0),
    'posts_total',    coalesce(sum(plays) filter (where src = 'posts'), 0)
  )
  from posts;
$$;

revoke execute on function public.get_views_summary(uuid) from public, anon, authenticated;
grant execute on function public.get_views_summary(uuid) to service_role;
