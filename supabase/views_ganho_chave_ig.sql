-- Correção do views_ganho_dos_posts.sql (2026-11-27).
--
-- O backfill e o trigger chaveiam o ganho dos posts pelo ID do Instagram da
-- conta (instagram_accounts.ig_business_account_id). Conta já excluída do SaaS
-- não está mais lá, e a linha ganhava o id da conta do SaaS como chave: não
-- casava com o insight da Meta (chaveado pelo ID do Instagram) e o card somava
-- os dois. Medido: "Ontem" 215.290 em vez de 88.402.
--
-- 1. Trigger: conta excluída → ID do Instagram lido de account_views_daily.
-- 2. Dados: linhas com chave = id da conta do SaaS passam para o ID do
--    Instagram (somando se já existir linha do mesmo dia).
--
-- Idempotente. Aplicar no SQL Editor.

create or replace function public.track_post_views_daily()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_src     text := case when tg_table_name = 'scheduled_posts' then 'posts' else 'loop' end;
  v_row     jsonb;
  v_prev    bigint;
  v_prev_at timestamptz;
  v_from    timestamptz;
  v_now     timestamptz := now();
  v_mid     timestamptz;
  v_today   date;
  v_delta   bigint;
  v_part    bigint;
  v_ig      text;
begin
  if new.insights_plays is null or new.account_id is null then
    return null;
  end if;

  begin
    select counted, counted_at into v_prev, v_prev_at
      from post_views_counted
     where source = v_src and post_id = new.id
       for update;

    v_delta := new.insights_plays - coalesce(v_prev, 0);
    if v_delta <= 0 then
      return null;
    end if;

    insert into post_views_counted (source, post_id, counted, counted_at)
    values (v_src, new.id, new.insights_plays, v_now)
    on conflict (source, post_id) do update
       set counted = excluded.counted, counted_at = excluded.counted_at;

    v_row  := to_jsonb(new);
    v_from := coalesce(v_prev_at,
                       (v_row->>'published_at')::timestamptz,
                       (v_row->>'created_at')::timestamptz,
                       v_now);

    select ig_business_account_id into v_ig
      from instagram_accounts
     where id = new.account_id;
    -- Conta excluída do SaaS: o ID do Instagram fica no histórico do insight.
    if v_ig is null then
      select ig_user_id into v_ig
        from account_views_daily
       where account_id = new.account_id and ig_user_id is not null
       order by day desc
       limit 1;
    end if;

    v_today := (v_now at time zone 'America/Sao_Paulo')::date;
    v_mid   := v_today::timestamp at time zone 'America/Sao_Paulo';

    v_part := v_delta;
    if v_from < v_mid and v_now > v_from then
      v_part := round(v_delta * extract(epoch from v_now - v_mid) / extract(epoch from v_now - v_from))::bigint;
      if v_delta - v_part > 0 then
        insert into account_post_views_daily (ig_user_id, account_id, user_id, day, views, updated_at)
        values (coalesce(v_ig, new.account_id::text), new.account_id, new.user_id,
                v_today - 1, v_delta - v_part, v_now)
        on conflict (ig_user_id, day) do update
           set views      = account_post_views_daily.views + excluded.views,
               updated_at = excluded.updated_at;
      end if;
    end if;

    if v_part > 0 then
      insert into account_post_views_daily (ig_user_id, account_id, user_id, day, views, updated_at)
      values (coalesce(v_ig, new.account_id::text), new.account_id, new.user_id,
              v_today, v_part, v_now)
      on conflict (ig_user_id, day) do update
         set views      = account_post_views_daily.views + excluded.views,
             account_id = excluded.account_id,
             user_id    = excluded.user_id,
             updated_at = excluded.updated_at;
    end if;
  exception when others then
    raise warning 'track_post_views_daily (%): % — %', tg_table_name, new.id, sqlerrm;
  end;

  return null;
end;
$$;

revoke execute on function public.track_post_views_daily() from public, anon, authenticated;

-- Dados: chave = id da conta do SaaS → ID do Instagram.
with map as (
  select distinct on (account_id) account_id, ig_user_id
    from public.account_views_daily
   where account_id is not null and ig_user_id is not null
   order by account_id, day desc
), errados as (
  delete from public.account_post_views_daily p
   using map m
   where p.ig_user_id = p.account_id::text
     and m.account_id = p.account_id
  returning m.ig_user_id, p.account_id, p.user_id, p.day, p.views
)
insert into public.account_post_views_daily (ig_user_id, account_id, user_id, day, views, updated_at)
select ig_user_id, (array_agg(account_id))[1], (array_agg(user_id))[1], day, sum(views), now()
  from errados
 group by ig_user_id, day
on conflict (ig_user_id, day) do update
   set views      = account_post_views_daily.views + excluded.views,
       updated_at = now();

-- Conferência: dias BRT recentes. Esperado em 27/11 ~16h: 26/11 ≈ 88 mil.
select day,
       sum(post_views)    as posts,
       sum(insight_views) as insight,
       sum(views)         as efetivo,
       (select count(*) from public.account_post_views_daily where ig_user_id = account_id::text) as chaves_sem_ig
  from public.account_views_effective
 where day >= current_date - 3
 group by day
 order by day desc;
