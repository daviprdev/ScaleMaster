-- Fase: Pastas da Biblioteca de Mídia
-- Executar no Supabase SQL Editor

-- 1. Tabela de pastas
CREATE TABLE IF NOT EXISTS public.library_folders (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name       text NOT NULL,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS library_folders_user_id_idx ON public.library_folders(user_id);
CREATE INDEX IF NOT EXISTS library_folders_created_at_idx ON public.library_folders(created_at);

ALTER TABLE public.library_folders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users_manage_own_folders"
  ON public.library_folders
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- 2. Coluna folder_id em videos_library (nulo = raiz)
ALTER TABLE public.videos_library
  ADD COLUMN IF NOT EXISTS folder_id uuid
  REFERENCES public.library_folders(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS videos_library_folder_id_idx ON public.videos_library(folder_id);
