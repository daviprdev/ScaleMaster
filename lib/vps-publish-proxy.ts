/**
 * lib/vps-publish-proxy.ts — antes escolhia uma das PUBLISH_PROXIES da VPS.
 *
 * No Cloudflare Workers não há proxy: toda publicação sai direto. A função
 * continua existindo para não mexer nos chamadores.
 */
// Sem imports `@/`: meta-publish.ts usa este módulo e é compilado isolado pela
// suíte de testes, fora do resolver de paths do Next.
import type { Dispatcher } from "./http";

export async function vpsPublishDispatcher(_key: string): Promise<Dispatcher | undefined> {
  return undefined;
}
