-- ═══════════════════════════════════════════════════════════════
-- saved_captions — Biblioteca de Legendas Salvas
-- Permite ao usuário salvar legendas recorrentes para reutilização
-- na aba Postar (campanha em lote).
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.saved_captions (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title      text,
  content    text        NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.saved_captions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users_manage_own_saved_captions"
  ON public.saved_captions
  FOR ALL
  USING  (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS saved_captions_user_id_idx
  ON public.saved_captions (user_id, created_at DESC);
