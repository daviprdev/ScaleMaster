-- Gráfico "crescimento de usuários" do painel admin, por dia de Brasília (2026-10-16).
--
-- app/api/admin/stats chama admin.rpc("admin_user_growth_30d"), mas a função
-- nunca foi versionada aqui. Sem ela, a rota cai no fallback em Node, que
-- conta só a primeira página de auth.admin.listUsers (1000 usuários). Esta
-- versão agrupa auth.users por data em America/Sao_Paulo, com a mesma
-- janela do fallback: os 29 dias anteriores mais hoje (BRT). A rota preenche
-- com zero os dias sem cadastro.
--
-- Para conferir se já existe uma versão no banco antes de rodar:
--   select pg_get_functiondef(p.oid)
--     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--    where n.nspname = 'public' and p.proname = 'admin_user_growth_30d';

-- drop: create or replace falha se uma versão antiga tiver outro tipo de retorno.
drop function if exists public.admin_user_growth_30d();

create function public.admin_user_growth_30d()
returns table ("date" text, users integer)
language sql
stable
security definer
set search_path = public
as $$
  select to_char((u.created_at at time zone 'America/Sao_Paulo')::date, 'YYYY-MM-DD'),
         count(*)::integer
    from auth.users u
   where (u.created_at at time zone 'America/Sao_Paulo')::date
         >= (now() at time zone 'America/Sao_Paulo')::date - 29
   group by 1
   order by 1;
$$;

-- Lê auth.users: só o servidor (service_role) pode chamar.
revoke execute on function public.admin_user_growth_30d() from public, anon, authenticated;
grant execute on function public.admin_user_growth_30d() to service_role;
