// Antes: round-robin do Estoque de proxies por publicação ("Usar minhas proxies").
// No Cloudflare Workers não há proxy: a seleção sempre volta vazia e os crons de
// publicação tratam todo post como use_proxy_pool=false.
// decisão: sem proxies na publicação desde a migração.

import type { Dispatcher } from "@/lib/http";

type AdminClient = any;

export interface SelectedProxy {
  poolId: string;
  agent: Dispatcher;
  safeLabel: string;
}

export async function selectProxyForPublish(
  _admin: AdminClient,
  _userId: string,
  _postId: string,
  _preferredPoolId?: string | null
): Promise<SelectedProxy | null> {
  return null;
}

export async function closeProxyAgent(_proxy: SelectedProxy | null): Promise<void> {}
