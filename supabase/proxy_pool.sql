-- ---------------------------------------------------------------------------
-- Estoque de Proxies (2026-07-17)
--
-- Pool de proxies do usuário. Contas novas recebem proxy automaticamente no
-- callback OAuth via claim atômico (UPDATE ... WHERE assigned_account_id IS NULL).
--
-- proxy_url:  criptografado AES-256-GCM (lib/encrypt.ts) — mesmo formato da
--             coluna instagram_accounts.proxy_url (ciphertext é copiado 1:1).
-- proxy_hash: SHA-256 da URL normalizada (plaintext) — permite dedup via UNIQUE
--             mesmo com criptografia não-determinística.
-- was_used:   proxy devolvido ao estoque após exclusão da conta (opção 2 do
--             usuário): só é redistribuído quando os limpos acabarem.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.proxy_pool (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  proxy_url text NOT NULL,
  proxy_hash text NOT NULL,
  assigned_account_id uuid REFERENCES public.instagram_accounts(id) ON DELETE SET NULL,
  was_used boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, proxy_hash)
);

CREATE INDEX IF NOT EXISTS proxy_pool_user_id_idx ON public.proxy_pool(user_id);
CREATE INDEX IF NOT EXISTS proxy_pool_assigned_idx ON public.proxy_pool(assigned_account_id);

ALTER TABLE public.proxy_pool ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "users_manage_own_proxy_pool" ON public.proxy_pool;
CREATE POLICY "users_manage_own_proxy_pool" ON public.proxy_pool
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- Devolução automática: ao excluir uma conta (qualquer caminho — card, bulk,
-- cascade de pasta, admin), o proxy dela volta ao estoque marcado como
-- was_used=true. BEFORE DELETE: roda enquanto assigned_account_id ainda aponta
-- para a conta (antes do FK ON DELETE SET NULL limpar a referência).
CREATE OR REPLACE FUNCTION public.release_proxy_on_account_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.proxy_pool
  SET assigned_account_id = NULL,
      was_used = true
  WHERE assigned_account_id = OLD.id;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_release_proxy_on_account_delete ON public.instagram_accounts;
CREATE TRIGGER trg_release_proxy_on_account_delete
  BEFORE DELETE ON public.instagram_accounts
  FOR EACH ROW EXECUTE FUNCTION public.release_proxy_on_account_delete();
