-- Fase: pending message field
-- Run in Supabase Dashboard → SQL Editor

ALTER TABLE public.user_roles
  ADD COLUMN IF NOT EXISTS pending_message text;
