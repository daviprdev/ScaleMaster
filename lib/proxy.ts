/**
 * lib/proxy.ts — Suporte a proxies estáticos por conta para chamadas à Meta Graph API.
 *
 * Modelo: 1 proxy fixo por conta — IP nunca muda.
 *   1. instagram_accounts.proxy_url (AES-256-GCM via ENCRYPTION_SECRET) → proxy dedicado da conta
 *   2. null → sem proxy (chamadas saem pelo IP da Vercel)
 *
 * Configurar via UI: menu ⋯ do card da conta → "Configurar Proxy"
 *
 * Formato suportado de URL de proxy:
 *   http://user:pass@proxy.host.com:port
 *   socks5://user:pass@proxy.host.com:port
 */

import { ProxyAgent } from "undici";
import { decrypt } from "@/lib/encrypt";

/**
 * Censura a senha da URL de proxy para uso em logs (nunca expõe credenciais).
 * http://user:SENHA@host:port → http://user:***@host:port
 */
function censorProxyUrl(url: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.password) parsed.password = "***";
    return parsed.toString();
  } catch {
    // Fallback regex caso a URL seja inválida para o construtor URL
    return url.replace(/:([^:@]+)@/, ":***@");
  }
}

// WeakMap: ProxyAgent → URL censurada para log nos pontos de disparo HTTP.
// Elimina a necessidade de passar a URL por toda a call stack só para logging.
const proxyLabels = new WeakMap<ProxyAgent, string>();

/**
 * Retorna a URL censurada registrada para o agent (para log de pré-disparo).
 * Retorna undefined se o agent não foi criado por este módulo.
 */
export function getProxyLabel(agent: ProxyAgent): string | undefined {
  return proxyLabels.get(agent);
}

/**
 * Constrói um ProxyAgent undici a partir de uma URL de proxy.
 * Retorna null se a URL for inválida.
 */
function buildProxyAgent(rawUrl: string, accountId: string): ProxyAgent | null {
  try {
    const agent = new ProxyAgent(rawUrl);
    proxyLabels.set(agent, censorProxyUrl(rawUrl));
    return agent;
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
        console.log(`[proxy] @${accountId.slice(0, 8)}… → proxy dedicado | ${proxyLabels.get(agent) ?? "URL configurada"}`);
        return agent;
      }
    } catch (e) {
      console.warn(`[proxy] Falha ao descriptografar proxy_url para @${accountId.slice(0, 8)}…: ${String(e)}`);
    }
  }

  // 2. Sem proxy — IP da Vercel
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
