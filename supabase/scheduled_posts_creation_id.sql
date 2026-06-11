-- Fix: dois-fase no publish-scheduled
-- Cada post cria container UMA vez, salva creation_id, e polls reutilizam o mesmo container.
-- Elimina o loop de 120 criações/hora que causava rate-limit e bloqueio de contas.

ALTER TABLE public.scheduled_posts
  ADD COLUMN IF NOT EXISTS creation_id text;
