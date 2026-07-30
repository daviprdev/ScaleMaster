-- ---------------------------------------------------------------------------
-- Estoque de Proxies (2026-07-17, política de reaproveitamento desde 2026-07-30)
--
-- Pool de proxies do usuário. Contas novas recebem proxy automaticamente no
-- callback OAuth via claim atômico (UPDATE ... WHERE assigned_account_id IS NULL).
--
-- Política atual (decisão do usuário, corte de custo de proxy):
--  - Proxy de conta excluída volta ao estoque como LIVRE — não é mais
--    deletado. A FK `assigned_account_id ON DELETE SET NULL` já faz isso
--    sozinha quando a conta é excluída (por qualquer caminho: card, bulk,
--    cascade de pasta, admin) — por isso NÃO HÁ MAIS trigger nesta tabela
--    (o trigger `trg_release_proxy_on_account_delete`, que deletava a
--    entrada, foi removido em 2026-07-30, migration
--    `proxy_pool_reuse_instead_of_delete`).
--  - Proxy removido/trocado manualmente na conta (PATCH /api/accounts/[id])
--    ou via CSV (bulk-proxy) também libera a entrada (assigned_account_id =
--    null) em vez de deletá-la.
--  - Antes de reatribuir um proxy livre a uma conta nova, `claimProxyForAccount`
--    (lib/proxy-pool.ts) testa conectividade real (ipify, timeout curto). Se
--    o proxy estiver morto, a entrada é deletada de vez (não fica "zumbi" no
--    estoque) e o próximo candidato livre é tentado.
--
-- proxy_url:  criptografado AES-256-GCM (lib/encrypt.ts) — mesmo formato da
--             coluna instagram_accounts.proxy_url (ciphertext é copiado 1:1).
-- proxy_hash: SHA-256 da URL normalizada (plaintext) — permite dedup via UNIQUE
--             mesmo com criptografia não-determinística.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.proxy_pool (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  proxy_url text NOT NULL,
  proxy_hash text NOT NULL,
  assigned_account_id uuid REFERENCES public.instagram_accounts(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, proxy_hash)
);

CREATE INDEX IF NOT EXISTS proxy_pool_user_id_idx ON public.proxy_pool(user_id);
CREATE INDEX IF NOT EXISTS proxy_pool_assigned_idx ON public.proxy_pool(assigned_account_id);

ALTER TABLE public.proxy_pool ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "users_manage_own_proxy_pool" ON public.proxy_pool;
CREATE POLICY "users_manage_own_proxy_pool" ON public.proxy_pool
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- Reaproveitamento: NÃO recriar o trigger de exclusão em cascata. A FK
-- `ON DELETE SET NULL` acima já libera a entrada automaticamente quando a
-- conta é excluída — nenhum trigger extra é necessário.
DROP TRIGGER IF EXISTS trg_release_proxy_on_account_delete ON public.instagram_accounts;
DROP FUNCTION IF EXISTS public.release_proxy_on_account_delete();
