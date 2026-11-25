/**
 * lib/proxy.ts — proxy por conta.
 *
 * No Cloudflare Workers não existe ProxyAgent: toda chamada sai direto. As
 * funções continuam com a mesma assinatura e sempre respondem "sem proxy".
 * O que usava: verificador de perfis (app/api/instagram/checker).
 */

import type { Dispatcher } from "@/lib/http";

export type ProxyAgent = Dispatcher;

export function getProxyLabel(_agent: ProxyAgent): string | undefined {
  return undefined;
}

export function getProxyForAccount(
  _accountId: string,
  _encryptedProxyUrl?: string | null
): ProxyAgent | null {
  return null;
}

export function proxyInit(_agent: ProxyAgent | null, base?: RequestInit): RequestInit {
  return base ?? {};
}

export function buildAgentFromEncrypted(_encryptedUrl: string, _label: string): ProxyAgent | null {
  return null;
}
