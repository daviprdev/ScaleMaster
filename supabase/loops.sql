-- Fase: Módulo de Looping
-- Executar no Supabase SQL Editor

-- 1. Tabela principal de loops
CREATE TABLE IF NOT EXISTS public.loops (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  folder_id        uuid REFERENCES public.library_folders(id) ON DELETE SET NULL,
  name             text NOT NULL DEFAULT 'Meu Loop',
  is_infinite      boolean NOT NULL DEFAULT true,
  cycles           int NOT NULL DEFAULT 1,
  interval_minutes int NOT NULL DEFAULT 10,
  captions         text[] NOT NULL DEFAULT '{}',
  cover_image_url  text,
  effect_mirror    boolean NOT NULL DEFAULT false,
  effect_invert    boolean NOT NULL DEFAULT false,
  status           text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'paused')),
  created_at       timestamptz DEFAULT now(),
  updated_at       timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS loops_user_id_idx ON public.loops(user_id);
CREATE INDEX IF NOT EXISTS loops_status_idx ON public.loops(status);
CREATE INDEX IF NOT EXISTS loops_folder_id_idx ON public.loops(folder_id);

ALTER TABLE public.loops ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users_manage_own_loops"
  ON public.loops
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- 2. Tabela relacional loop_accounts (N:N)
CREATE TABLE IF NOT EXISTS public.loop_accounts (
  loop_id    uuid NOT NULL REFERENCES public.loops(id) ON DELETE CASCADE,
  account_id uuid NOT NULL REFERENCES public.instagram_accounts(id) ON DELETE CASCADE,
  PRIMARY KEY (loop_id, account_id)
);

CREATE INDEX IF NOT EXISTS loop_accounts_loop_id_idx ON public.loop_accounts(loop_id);
CREATE INDEX IF NOT EXISTS loop_accounts_account_id_idx ON public.loop_accounts(account_id);

ALTER TABLE public.loop_accounts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users_manage_own_loop_accounts"
  ON public.loop_accounts
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.loops
      WHERE loops.id = loop_accounts.loop_id
        AND loops.user_id = auth.uid()
    )
  );

-- 3. Função para atualizar updated_at automaticamente
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER loops_updated_at
  BEFORE UPDATE ON public.loops
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- NOTA: As capas dos loops são armazenadas no bucket 'videos-library'
-- sob o caminho 'covers/'. Nenhuma ação adicional necessária.
