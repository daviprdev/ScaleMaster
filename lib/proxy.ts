/**
 * lib/proxy.ts — Suporte a proxies residenciais para chamadas à Meta Graph API.
 *
 * Prioridade por conta:
 *   1. instagram_accounts.proxy_url (AES-256-GCM via ENCRYPTION_SECRET) — proxy dedicado
 *   2. PROXY_URL_TEMPLATE env var com placeholder {SESSION} — sticky session por conta
 *   3. Sem proxy (comportamento atual) — todas as chamadas saem do IP da Vercel
 *
 * Sticky session: o session ID é derivado deterministicamente do account_id com
 * SHA-256 truncado a 8 hex chars. Provedores como Bright Data, Smartproxy, IPRoyal e
 * Oxylabs aceitam `username-session-{ID}:password@host:port` e retornam sempre o
 * mesmo IP residencial para o mesmo session ID (por ~10–30 min).
 *
 * Formato suportado de URL de proxy:
 *   http://user:pass@proxy.host.com:port
 *   http://user-session-{SESSION}:pass@proxy.host.com:port  ← template com placeholder
 *   socks5://user:pass@proxy.host.com:port
 */

import crypto from "crypto";
import { ProxyAgent } from "undici";
import { decrypt } from "@/lib/encrypt";

/**
 * Gera um session ID de 8 hex chars determinístico para o account_id.
 * Mesmo account_id → mesmo ID → mesmo IP residencial (sticky session).
 */
function sessionId(accountId: string): string {
  return crypto.createHash("sha256").update(accountId).digest("hex").slice(0, 8);
}

/**
 * Constrói um ProxyAgent undici a partir de uma URL de proxy.
 * Substitui {SESSION} pelo session ID gerado para o account_id.
 * Retorna null se a URL for inválida.
 */
function buildProxyAgent(rawUrl: string, accountId: string): ProxyAgent | null {
  try {
    const url = rawUrl.replace("{SESSION}", sessionId(accountId));
    return new ProxyAgent(url);
  } catch (e) {
    console.warn(`[proxy] URL inválida para @account ${accountId.slice(0, 8)}…: ${String(e)}`);
    return null;
  }
}

/**
 * Retorna um ProxyAgent configurado para a conta, ou null se não houver proxy.
 *
 * @param accountId  - ID da conta Instagram (UUID)
 * @param encryptedProxyUrl - proxy_url criptografada do banco (pode ser null/undefined)
 */
export function getProxyForAccount(
  accountId: string,
  encryptedProxyUrl?: string | null
): ProxyAgent | null {
  // 1. Proxy dedicado da conta (AES-256-GCM)
  if (encryptedProxyUrl) {
    try {
      const raw = decrypt(encryptedProxyUrl);
      const agent = buildProxyAgent(raw, accountId);
      if (agent) {
        console.log(`[proxy] @${accountId.slice(0, 8)}… → proxy dedicado (sessão ${sessionId(accountId)})`);
        return agent;
      }
    } catch (e) {
      console.warn(`[proxy] Falha ao descriptografar proxy_url para @${accountId.slice(0, 8)}…: ${String(e)}`);
    }
  }

  // 2. Template global de proxy (env var PROXY_URL_TEMPLATE)
  const template = process.env.PROXY_URL_TEMPLATE;
  if (template) {
    const agent = buildProxyAgent(template, accountId);
    if (agent) {
      const sid = sessionId(accountId);
      console.log(`[proxy] @${accountId.slice(0, 8)}… → template global (sessão ${sid})`);
      return agent;
    }
  }

  // 3. Sem proxy — comportamento padrão
  return null;
}

/**
 * Converte um ProxyAgent undici para o objeto `{ dispatcher }` que o fetch aceita.
 * O TypeScript padrão não inclui `dispatcher` nos tipos de RequestInit, mas undici
 * suporta essa extensão. Usamos um cast seguro para evitar erros de compilação.
 */
export function proxyInit(
  agent: ProxyAgent | null,
  base?: RequestInit
): RequestInit {
  if (!agent) return base ?? {};
  // undici's fetch aceita `dispatcher` além do RequestInit padrão
  return { ...(base ?? {}), dispatcher: agent } as RequestInit;
}
