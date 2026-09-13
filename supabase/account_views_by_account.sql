-- Views reais agregadas POR CONTA (2026-09-13) — alimenta o ranking do Loop.
--
-- account_views_daily tem uma linha por conta × dia (até ~90 por conta); com
-- dezenas de contas, ler as linhas pelo PostgREST bateria no teto de 1000.
-- A agregação no banco devolve UM jsonb { account_id: {total, last_7d, last_24h} }.
--
-- SECURITY DEFINER sem checagem de dono: EXECUTE só para service_role; a rota
-- passa apenas ids de contas que já validou como do usuário.

create or replace function public.get_account_views_by_account(p_account_ids uuid[])
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_object_agg(account_id, jsonb_build_object(
           'total',    total,
           'last_7d',  last_7d,
           'last_24h', last_24h
         )), '{}'::jsonb)
    from (
      select account_id,
             sum(views) as total,
             sum(views) filter (where day >= (now() at time zone 'utc')::date - 6) as last_7d,
             sum(views) filter (where day >= (now() at time zone 'utc')::date - 1) as last_24h
        from account_views_daily
       where account_id = any(p_account_ids)
       group by account_id
    ) t;
$$;

revoke execute on function public.get_account_views_by_account(uuid[]) from public, anon, authenticated;
grant execute on function public.get_account_views_by_account(uuid[]) to service_role;
