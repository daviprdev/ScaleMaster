-- Fase: Loop vinculado a pasta de contas
-- Quando configurado, o cron busca dinamicamente contas saudáveis da pasta
-- em vez de usar a lista fixa de loop_accounts.

ALTER TABLE public.loops
  ADD COLUMN IF NOT EXISTS account_folder_id uuid
    REFERENCES public.account_folders(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS loops_account_folder_id_idx
  ON public.loops(account_folder_id);
