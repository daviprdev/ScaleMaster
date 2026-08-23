/**
 * lib/proxy.ts — Proxy residencial dedicado por conta para chamadas à Meta Graph API.
 *
 * Prioridade:
 *   1. instagram_accounts.proxy_url (AES-256-GCM) → proxy dedicado individual (estoque)
 *   2. null                                       → sem proxy (IP Vercel)
 *
 * Política do projeto (2026-07-15): "sem proxy = sem sync/postagem" — nenhuma
 * chamada em nome de uma conta sai pelo IP datacenter da Vercel. Contas sem
 * proxy dedicado ficam paradas até receberem um do estoque (/dashboard/proxy-test),
 * não caem para IP direto.
 *
 * O antigo fallback via PROXY_URL_TEMPLATE (sessão sticky por account_id no
 * Smartproxy) foi removido em 2026-06-14 — sticky session rotacionava o IP de
 * várias contas ao mesmo tempo e causava cascata. Ver CLAUDE.md.
 */

import { ProxyAgent } from "undici";
import { decrypt } from "@/lib/encrypt";

// ── Logging ──────────────────────────────────────────────────────────────────

function censorProxyUrl(url: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.password) parsed.password = "***";
    return parsed.toString();
  } catch {
    return url.replace(/:([^:@]+)@/, ":***@");
  }
}

const proxyLabels = new WeakMap<ProxyAgent, string>();

export function getProxyLabel(agent: ProxyAgent): string | undefined {
  return proxyLabels.get(agent);
}

// ── ProxyAgent builder ────────────────────────────────────────────────────────

function buildProxyAgent(rawUrl: string, accountId: string): ProxyAgent | null {
  try {
    const agent = new ProxyAgent(rawUrl);
    proxyLabels.set(agent, censorProxyUrl(rawUrl));
    return agent;
  } catch (e) {
    console.warn(`[proxy] URL inválida para account ${accountId.slice(0, 8)}…: ${String(e)}`);
    return null;
  }
}

// ── getProxyForAccount ────────────────────────────────────────────────────────

/**
 * Retorna um ProxyAgent para a conta, ou null se nenhum proxy estiver configurado.
 *
 * Ordem de prioridade:
 *   1. proxy_url individual no banco (AES-256-GCM)
 *   2. null → IP da Vercel (sem proxy)
 */
export function getProxyForAccount(
  accountId: string,
  encryptedProxyUrl?: string | null
): ProxyAgent | null {
  // 1. Proxy individual da conta
  if (encryptedProxyUrl) {
    try {
      const raw = decrypt(encryptedProxyUrl);
      const agent = buildProxyAgent(raw, accountId);
      if (agent) {
        console.log(
          `[proxy] ${accountId.slice(0, 8)}… → dedicado | ${proxyLabels.get(agent)}`
        );
        return agent;
      }
    } catch (e) {
      console.warn(`[proxy] Falha ao descriptografar proxy_url de ${accountId.slice(0, 8)}…: ${String(e)}`);
    }
  }

  // 2. Sem proxy dedicado — política do projeto é não cair pro IP da Vercel.
  return null;
}

// ── Rastreamento de falha de proxy ───────────────────────────────────────────

/**
 * Detecta erros de rede do proxy (túnel recusado, credencial inválida, timeout).
 * O undici reporta CONNECT 407 e conexão cortada como "fetch failed" genérico.
 */
export function isProxyNetworkError(msg: string): boolean {
  const lower = msg.toLowerCase();
  return (
    lower.includes("fetch failed") ||
    lower.includes("[proxy]") ||
    lower.includes("proxy dedicado falhou") ||
    lower.includes("econnreset") ||
    lower.includes("econnrefused") ||
    lower.includes("socket hang up")
  );
}

/**
 * Persiste a falha de proxy na conta para o ProxyOutageBanner do dashboard.
 * Sem isso, quedas do provedor (todas as contas ao mesmo tempo) ficam invisíveis
 * no painel — os crons apenas pulam as contas em silêncio (outage 2026-07-09).
 * Sempre await (fire-and-forget é cancelado pelo serverless da Vercel).
 */
export async function recordProxyFailure(
  admin: unknown,
  accountId: string,
  source: string,
  message: string
): Promise<void> {
  try {
    await (admin as { from: (t: string) => any })
      .from("instagram_accounts")
      .update({
        last_proxy_error_at: new Date().toISOString(),
        last_proxy_error: `[${source}] ${message}`.slice(0, 300),
      })
      .eq("id", accountId);
  } catch (e) {
    console.warn(`[proxy-health] Falha ao registrar erro de proxy (${accountId.slice(0, 8)}…): ${String(e)}`);
  }
}

// ── proxyInit ─────────────────────────────────────────────────────────────────

export function proxyInit(
  agent: ProxyAgent | null,
  base?: RequestInit
): RequestInit {
  if (!agent) return base ?? {};
  return { ...(base ?? {}), dispatcher: agent } as RequestInit;
}
