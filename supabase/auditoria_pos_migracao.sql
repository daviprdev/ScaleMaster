-- supabase/auditoria_pos_migracao.sql — ajustes do Security/Performance Advisor (25/11/2026).
-- Nenhuma regra de acesso muda: as políticas continuam com a mesma condição.
--
-- 1. auth.uid()/auth.role() dentro de (select …): o Postgres calcula uma vez por
--    consulta em vez de uma vez por linha (lint auth_rls_initplan).
-- 2. scheduled_posts tinha duas políticas ALL idênticas; sai a duplicada.
-- 3. search_path fixo na função de trigger (lint function_search_path_mutable).
-- 4. Índice nas chaves estrangeiras sem índice (lint unindexed_foreign_keys).
--
-- Gerado a partir de pg_policies/pg_constraint do projeto em 25/11/2026.
-- Rodar inteiro no SQL Editor; o select do fim mostra o que ficou.

begin;

-- 1. Políticas ---------------------------------------------------------------
ALTER POLICY admins_select_notifications ON public.notifications USING ((EXISTS ( SELECT 1 FROM user_roles ur WHERE ((ur.user_id = (select auth.uid())) AND (ur.role = 'admin'::text)))));
ALTER POLICY admins_select_sales ON public.sales USING ((EXISTS ( SELECT 1 FROM user_roles ur WHERE ((ur.user_id = (select auth.uid())) AND (ur.role = 'admin'::text)))));
ALTER POLICY ig_browser_sessions_owner_select ON public.ig_browser_sessions USING (((select auth.uid()) = user_id));
ALTER POLICY media_delete_own ON public.onboarding_media_library USING (((select auth.uid()) = user_id));
ALTER POLICY media_insert_own ON public.onboarding_media_library WITH CHECK (((select auth.uid()) = user_id));
ALTER POLICY media_select_own ON public.onboarding_media_library USING (((select auth.uid()) = user_id));
ALTER POLICY onboarding_jobs_owner_delete ON public.onboarding_jobs USING (((select auth.uid()) = user_id));
ALTER POLICY onboarding_jobs_owner_insert ON public.onboarding_jobs WITH CHECK (((select auth.uid()) = user_id));
ALTER POLICY onboarding_jobs_owner_select ON public.onboarding_jobs USING (((select auth.uid()) = user_id));
ALTER POLICY onboarding_jobs_owner_update ON public.onboarding_jobs USING (((select auth.uid()) = user_id)) WITH CHECK (((select auth.uid()) = user_id));
ALTER POLICY own_role_select ON public.user_roles USING (((select auth.uid()) = user_id));
ALTER POLICY owner_only_logins ON public.account_logins USING (((select auth.uid()) = user_id)) WITH CHECK (((select auth.uid()) = user_id));
ALTER POLICY owner_only_reader_accounts ON public.reader_accounts USING (((select auth.uid()) = user_id)) WITH CHECK (((select auth.uid()) = user_id));
ALTER POLICY service_role_write ON public.user_roles USING (((select auth.role()) = 'service_role'::text));
ALTER POLICY templates_delete_own ON public.onboarding_templates USING (((select auth.uid()) = user_id));
ALTER POLICY templates_insert_own ON public.onboarding_templates WITH CHECK (((select auth.uid()) = user_id));
ALTER POLICY templates_select_own ON public.onboarding_templates USING (((select auth.uid()) = user_id));
ALTER POLICY templates_update_own ON public.onboarding_templates USING (((select auth.uid()) = user_id));
ALTER POLICY users_delete_own_videos ON public.videos_library USING (((select auth.uid()) = user_id));
ALTER POLICY users_insert_own_videos ON public.videos_library WITH CHECK (((select auth.uid()) = user_id));
ALTER POLICY users_manage_own_account_folders ON public.account_folders USING (((select auth.uid()) = user_id)) WITH CHECK (((select auth.uid()) = user_id));
ALTER POLICY users_manage_own_accounts ON public.instagram_accounts USING (((select auth.uid()) = user_id)) WITH CHECK (((select auth.uid()) = user_id));
ALTER POLICY users_manage_own_analytics_history ON public.account_analytics_history USING (((select auth.uid()) = user_id)) WITH CHECK (((select auth.uid()) = user_id));
ALTER POLICY users_manage_own_automation_account_folders ON public.automation_account_folders USING ((EXISTS ( SELECT 1 FROM automations a WHERE ((a.id = automation_account_folders.automation_id) AND (a.user_id = (select auth.uid()))))));
ALTER POLICY users_manage_own_automation_video_folders ON public.automation_video_folders USING ((EXISTS ( SELECT 1 FROM automations a WHERE ((a.id = automation_video_folders.automation_id) AND (a.user_id = (select auth.uid()))))));
ALTER POLICY users_manage_own_automations ON public.automations USING (((select auth.uid()) = user_id)) WITH CHECK (((select auth.uid()) = user_id));
ALTER POLICY users_manage_own_distribute_campaigns ON public.distribute_campaigns USING (((select auth.uid()) = user_id)) WITH CHECK (((select auth.uid()) = user_id));
ALTER POLICY users_manage_own_failover_logs ON public.failover_logs USING (((select auth.uid()) = user_id)) WITH CHECK (((select auth.uid()) = user_id));
ALTER POLICY users_manage_own_folders ON public.library_folders USING (((select auth.uid()) = user_id)) WITH CHECK (((select auth.uid()) = user_id));
ALTER POLICY users_manage_own_links ON public.managed_links USING (((select auth.uid()) = user_id)) WITH CHECK (((select auth.uid()) = user_id));
ALTER POLICY users_manage_own_loop_accounts ON public.loop_accounts USING ((EXISTS ( SELECT 1 FROM loops WHERE ((loops.id = loop_accounts.loop_id) AND (loops.user_id = (select auth.uid()))))));
ALTER POLICY users_manage_own_loops ON public.loops USING (((select auth.uid()) = user_id)) WITH CHECK (((select auth.uid()) = user_id));
ALTER POLICY users_manage_own_magic_tokens ON public.magic_add_tokens USING (((select auth.uid()) = user_id)) WITH CHECK (((select auth.uid()) = user_id));
ALTER POLICY users_manage_own_meta_apps ON public.user_meta_apps USING (((select auth.uid()) = user_id)) WITH CHECK (((select auth.uid()) = user_id));
ALTER POLICY users_manage_own_notification_settings ON public.notification_settings USING (((select auth.uid()) = user_id)) WITH CHECK (((select auth.uid()) = user_id));
ALTER POLICY users_manage_own_posts ON public.scheduled_posts USING (((select auth.uid()) = user_id)) WITH CHECK (((select auth.uid()) = user_id));
ALTER POLICY users_manage_own_proxy_pool ON public.proxy_pool USING (((select auth.uid()) = user_id)) WITH CHECK (((select auth.uid()) = user_id));
ALTER POLICY users_manage_own_push_subscriptions ON public.push_subscriptions USING (((select auth.uid()) = user_id)) WITH CHECK (((select auth.uid()) = user_id));
ALTER POLICY users_manage_own_sale_notifications ON public.sale_notifications USING (((select auth.uid()) = user_id)) WITH CHECK (((select auth.uid()) = user_id));
ALTER POLICY users_manage_own_sale_webhook_configs ON public.sale_webhook_configs USING (((select auth.uid()) = user_id)) WITH CHECK (((select auth.uid()) = user_id));
ALTER POLICY users_manage_own_saved_captions ON public.saved_captions USING (((select auth.uid()) = user_id)) WITH CHECK (((select auth.uid()) = user_id));
ALTER POLICY users_manage_own_schedule ON public.human_schedule_settings USING (((select auth.uid()) = user_id)) WITH CHECK (((select auth.uid()) = user_id));
ALTER POLICY users_manage_own_scraped_profiles ON public.scraped_profiles USING (((select auth.uid()) = user_id)) WITH CHECK (((select auth.uid()) = user_id));
ALTER POLICY users_manage_own_sessions ON public.user_sessions USING (((select auth.uid()) = user_id)) WITH CHECK (((select auth.uid()) = user_id));
ALTER POLICY users_manage_own_single_post_accounts ON public.single_post_accounts USING ((EXISTS ( SELECT 1 FROM single_posts WHERE ((single_posts.id = single_post_accounts.post_id) AND (single_posts.user_id = (select auth.uid()))))));
ALTER POLICY users_manage_own_single_posts ON public.single_posts USING (((select auth.uid()) = user_id)) WITH CHECK (((select auth.uid()) = user_id));
ALTER POLICY users_manage_own_story_media ON public.story_media USING (((select auth.uid()) = user_id)) WITH CHECK (((select auth.uid()) = user_id));
ALTER POLICY users_manage_own_story_template_accounts ON public.story_template_accounts USING ((EXISTS ( SELECT 1 FROM story_templates WHERE ((story_templates.id = story_template_accounts.template_id) AND (story_templates.user_id = (select auth.uid()))))));
ALTER POLICY users_manage_own_story_templates ON public.story_templates USING (((select auth.uid()) = user_id)) WITH CHECK (((select auth.uid()) = user_id));
ALTER POLICY users_manage_own_video_variants ON public.video_variants USING (((select auth.uid()) = user_id)) WITH CHECK (((select auth.uid()) = user_id));
ALTER POLICY users_read_own_account_reels ON public.account_reels_daily USING (((select auth.uid()) = user_id));
ALTER POLICY users_read_own_account_views ON public.account_views_daily USING (((select auth.uid()) = user_id));
ALTER POLICY users_read_own_link_clicks ON public.managed_link_clicks USING ((EXISTS ( SELECT 1 FROM managed_links l WHERE ((l.id = managed_link_clicks.link_id) AND (l.user_id = (select auth.uid()))))));
ALTER POLICY users_read_own_link_history ON public.managed_link_history USING (((select auth.uid()) = user_id));
ALTER POLICY users_read_own_magic_tokens ON public.onboarding_magic_tokens USING (((select auth.uid()) = user_id));
ALTER POLICY users_read_own_scrape_searches ON public.inspiration_scrape_searches USING (((select auth.uid()) = user_id));
ALTER POLICY users_select_own_sales ON public.sales USING (((select auth.uid()) = user_id));
ALTER POLICY users_select_own_videos ON public.videos_library USING (((select auth.uid()) = user_id));
ALTER POLICY users_view_own_login_jobs ON public.login_jobs USING (((select auth.uid()) = user_id));
ALTER POLICY users_view_own_scrape_jobs ON public.scrape_jobs USING (((select auth.uid()) = user_id));

-- 2. Política duplicada (igual a users_manage_own_posts) ----------------------
DROP POLICY IF EXISTS users_manage_own_scheduled_posts ON public.scheduled_posts;

-- 3. search_path fixo --------------------------------------------------------
ALTER FUNCTION public.update_onboarding_templates_updated_at() SET search_path = public, pg_temp;

-- 4. Índices de chave estrangeira ---------------------------------------------
CREATE INDEX IF NOT EXISTS scheduled_posts_video_id_fk_idx ON public.scheduled_posts (video_id);
CREATE INDEX IF NOT EXISTS scheduled_posts_managed_link_id_fk_idx ON public.scheduled_posts (managed_link_id);
CREATE INDEX IF NOT EXISTS system_announcements_created_by_fk_idx ON public.system_announcements (created_by);
CREATE INDEX IF NOT EXISTS audit_logs_actor_id_fk_idx ON public.audit_logs (actor_id);
CREATE INDEX IF NOT EXISTS failover_logs_failed_account_id_fk_idx ON public.failover_logs (failed_account_id);
CREATE INDEX IF NOT EXISTS failover_logs_backup_account_id_fk_idx ON public.failover_logs (backup_account_id);
CREATE INDEX IF NOT EXISTS pending_containers_user_id_fk_idx ON public.pending_containers (user_id);
CREATE INDEX IF NOT EXISTS pending_containers_video_id_fk_idx ON public.pending_containers (video_id);
CREATE INDEX IF NOT EXISTS pending_containers_proxy_pool_id_used_fk_idx ON public.pending_containers (proxy_pool_id_used);
CREATE INDEX IF NOT EXISTS video_processing_jobs_user_id_fk_idx ON public.video_processing_jobs (user_id);
CREATE INDEX IF NOT EXISTS video_processing_jobs_loop_id_fk_idx ON public.video_processing_jobs (loop_id);
CREATE INDEX IF NOT EXISTS video_processing_jobs_video_id_fk_idx ON public.video_processing_jobs (video_id);
CREATE INDEX IF NOT EXISTS magic_add_tokens_app_id_fk_idx ON public.magic_add_tokens (app_id);
CREATE INDEX IF NOT EXISTS story_templates_source_account_id_fk_idx ON public.story_templates (source_account_id);
CREATE INDEX IF NOT EXISTS automation_account_folders_folder_id_fk_idx ON public.automation_account_folders (folder_id);
CREATE INDEX IF NOT EXISTS automation_video_folders_folder_id_fk_idx ON public.automation_video_folders (folder_id);
CREATE INDEX IF NOT EXISTS distribute_campaigns_video_folder_id_fk_idx ON public.distribute_campaigns (video_folder_id);
CREATE INDEX IF NOT EXISTS login_jobs_user_id_fk_idx ON public.login_jobs (user_id);
CREATE INDEX IF NOT EXISTS login_jobs_account_login_id_fk_idx ON public.login_jobs (account_login_id);
CREATE INDEX IF NOT EXISTS notifications_target_user_id_fk_idx ON public.notifications (target_user_id);
CREATE INDEX IF NOT EXISTS notifications_created_by_fk_idx ON public.notifications (created_by);
CREATE INDEX IF NOT EXISTS video_variants_user_id_fk_idx ON public.video_variants (user_id);
CREATE INDEX IF NOT EXISTS managed_link_history_user_id_fk_idx ON public.managed_link_history (user_id);
CREATE INDEX IF NOT EXISTS onboarding_jobs_account_id_fk_idx ON public.onboarding_jobs (account_id);
CREATE INDEX IF NOT EXISTS onboarding_templates_app_id_fk_idx ON public.onboarding_templates (app_id);
CREATE INDEX IF NOT EXISTS onboarding_magic_tokens_user_id_fk_idx ON public.onboarding_magic_tokens (user_id);
CREATE INDEX IF NOT EXISTS onboarding_magic_tokens_account_id_fk_idx ON public.onboarding_magic_tokens (account_id);
CREATE INDEX IF NOT EXISTS account_reels_daily_user_id_fk_idx ON public.account_reels_daily (user_id);

commit;

-- Conferência: políticas que ainda chamam auth.uid()/auth.role() por linha (esperado 0),
-- políticas de scheduled_posts (esperado 1) e índices novos (esperado 28).
select
  (select count(*) from pg_policies where schemaname = 'public'
     and (coalesce(qual, '') || coalesce(with_check, '')) ~ 'auth\.(uid|role)\(\)'
     and (coalesce(qual, '') || coalesce(with_check, '')) !~ 'SELECT auth\.(uid|role)\(\)') as politicas_por_linha,
  (select count(*) from pg_policies where schemaname = 'public' and tablename = 'scheduled_posts') as politicas_scheduled_posts,
  (select count(*) from pg_indexes where schemaname = 'public' and indexname like '%\_fk\_idx') as indices_fk;
