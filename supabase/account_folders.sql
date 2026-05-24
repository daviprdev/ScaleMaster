-- Account Folders: group instagram accounts by client/folder
-- Execute no Supabase Dashboard → SQL Editor

CREATE TABLE IF NOT EXISTS public.account_folders (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name       text NOT NULL,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS account_folders_user_id_idx ON public.account_folders(user_id);
CREATE INDEX IF NOT EXISTS account_folders_created_at_idx ON public.account_folders(created_at);

ALTER TABLE public.account_folders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users_manage_own_account_folders"
  ON public.account_folders
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Coluna folder_id em instagram_accounts (nulo = sem pasta / raiz)
ALTER TABLE public.instagram_accounts
  ADD COLUMN IF NOT EXISTS folder_id uuid REFERENCES public.account_folders(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS instagram_accounts_folder_id_idx ON public.instagram_accounts(folder_id);
