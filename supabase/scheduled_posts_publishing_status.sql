-- Fix: adiciona 'publishing' ao CHECK constraint de scheduled_posts.status
-- Sem isso, o CLAIM atômico (UPDATE status='publishing' WHERE status='pending')
-- retornava HTTP 400 e nenhuma campanha publicava.

ALTER TABLE public.scheduled_posts
  DROP CONSTRAINT IF EXISTS scheduled_posts_status_check;

ALTER TABLE public.scheduled_posts
  ADD CONSTRAINT scheduled_posts_status_check
  CHECK (status IN ('pending', 'publishing', 'published', 'failed', 'cancelled'));

NOTIFY pgrst, 'reload schema';
