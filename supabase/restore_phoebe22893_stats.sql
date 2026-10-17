-- Restauração única (produção, 2026-10-17): views e reels de @phoebe22893,
-- apagados em cascata quando a conta (caída por checkpoint) foi excluída em
-- 2026-10-17 ~00:13 BRT — antes de account_stats_keep_deleted.sql existir.
--
-- Origem dos números:
-- - views 3.312: medido em 2026-10-16 ao aplicar account_views_total_all_accounts.sql
--   (soma de todas as contas 19.764 − só ativas 16.452; a única conta fora das
--   ativas com linhas era @phoebe22893). O total por dia não foi guardado, então
--   vai num dia só: 2026-10-15, quando ela gerou quase tudo (caiu às 00:55 BRT de 16/10).
-- - reels 10: posts publicados da campanha f6a3fcd3 (9 em 15/10 entre 19:55 e
--   23:55 BRT, 1 em 16/10 às 00:25 BRT).
--
-- O ig_user_id real da conta se perdeu com a exclusão: placeholder
-- 'excluida:phoebe22893'. Se a mesma conta for reconectada, o backfill do sync
-- grava o histórico com o ID real e estas linhas devem ser apagadas para não
-- contar em dobro.

insert into public.account_views_daily (account_id, user_id, day, views, reach, ig_user_id, username, updated_at)
values ('0f113b2a-4273-4523-ba04-d002b7fe4d60', '92295283-45e7-482f-90f3-32dc4fb355ee',
        '2026-10-15', 3312, null, 'excluida:phoebe22893', 'phoebe22893', now())
on conflict do nothing;

insert into public.account_reels_daily (account_id, user_id, day, reels, ig_user_id, username, updated_at)
values ('0f113b2a-4273-4523-ba04-d002b7fe4d60', '92295283-45e7-482f-90f3-32dc4fb355ee',
        '2026-10-15', 9, 'excluida:phoebe22893', 'phoebe22893', now()),
       ('0f113b2a-4273-4523-ba04-d002b7fe4d60', '92295283-45e7-482f-90f3-32dc4fb355ee',
        '2026-10-16', 1, 'excluida:phoebe22893', 'phoebe22893', now())
on conflict do nothing;
