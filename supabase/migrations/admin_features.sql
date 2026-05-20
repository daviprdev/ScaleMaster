-- ─── audit_logs ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.audit_logs (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at   timestamptz DEFAULT now(),
  action       text        NOT NULL,
  actor_id     uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  actor_email  text,
  target_id    uuid,
  target_email text,
  details      jsonb       DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS audit_logs_created_at_idx
  ON public.audit_logs(created_at DESC);

ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

-- ─── system_announcements ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.system_announcements (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  message    text        NOT NULL,
  is_active  boolean     DEFAULT true,
  created_at timestamptz DEFAULT now(),
  created_by uuid        REFERENCES auth.users(id) ON DELETE SET NULL
);

ALTER TABLE public.system_announcements ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users_read_active_announcements"
  ON public.system_announcements FOR SELECT
  TO authenticated
  USING (is_active = true);
