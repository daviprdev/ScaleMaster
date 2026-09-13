-- 2026-09-13 — pending_containers ganha insights_shares / insights_saved.
--
-- lib/meta-insights.ts (insightsUpdatePayload) grava as mesmas 6 métricas nas
-- duas tabelas de post. scheduled_posts já tinha as 6; pending_containers (Loop)
-- só tinha likes/comments/plays/reach — o UPDATE inteiro era rejeitado pelo
-- PostgREST ("Could not find the 'insights_saved' column") e NENHUM post do Loop
-- recebia views, nem pelo cron sync-post-insights nem pelo analytics do loop.

alter table public.pending_containers
  add column if not exists insights_shares integer,
  add column if not exists insights_saved  integer;

notify pgrst, 'reload schema';
