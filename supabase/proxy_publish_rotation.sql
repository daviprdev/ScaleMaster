-- Rotação atômica e round-robin dos proxies livres por usuário.
-- Cada publicação nova avança uma posição; retries reutilizam o proxy_id salvo.

ALTER TABLE public.proxy_pool
  ADD COLUMN IF NOT EXISTS publish_last_used_at timestamptz;

CREATE INDEX IF NOT EXISTS proxy_pool_publish_rotation_idx
  ON public.proxy_pool (user_id, publish_last_used_at, created_at, id)
  WHERE assigned_account_id IS NULL;

ALTER TABLE public.pending_containers
  ADD COLUMN IF NOT EXISTS proxy_pool_id_used uuid
    REFERENCES public.proxy_pool(id) ON DELETE SET NULL;

CREATE OR REPLACE FUNCTION public.claim_next_publish_proxy(p_user_id uuid)
RETURNS TABLE(id uuid, proxy_url text, proxy_hash text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  selected_proxy public.proxy_pool%ROWTYPE;
BEGIN
  IF p_user_id IS NULL THEN
    RETURN;
  END IF;

  -- Serialize selections for one user so concurrent cron workers cannot
  -- repeatedly choose the same oldest proxy.
  PERFORM pg_advisory_xact_lock(hashtextextended(p_user_id::text, 0));

  SELECT p.*
    INTO selected_proxy
    FROM public.proxy_pool AS p
   WHERE p.user_id = p_user_id
     AND p.assigned_account_id IS NULL
   ORDER BY p.publish_last_used_at ASC NULLS FIRST, p.created_at ASC, p.id ASC
   LIMIT 1;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  UPDATE public.proxy_pool AS p
     SET publish_last_used_at = clock_timestamp()
   WHERE p.id = selected_proxy.id
  RETURNING p.* INTO selected_proxy;

  RETURN QUERY SELECT selected_proxy.id, selected_proxy.proxy_url, selected_proxy.proxy_hash;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_next_publish_proxy(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_next_publish_proxy(uuid) TO service_role;
