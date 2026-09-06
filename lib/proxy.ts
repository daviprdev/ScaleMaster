/**
 * lib/proxy.ts — Proxy residencial dedicado por conta.
 *
 * ESCOPO ATUAL (2026-09-06): as chamadas à API OFICIAL da Meta/Instagram saem
 * em conexão direta server-to-server e NÃO usam proxy. O que ainda usa:
 *
 *   - app/api/instagram/checker — consulta anônima ao endpoint web do
 *     Instagram (não é API oficial); empresta o proxy de alguma conta.
 *   - app/api/cron/process-instagram-logins — login via instagrapi no servidor
 *     Python; exige proxy dedicado por conta.
 *   - app/api/debug/proxy-* — diagnóstico dos proxies em si.
 *
 * Junto com a mudança de rede caiu a política "sem proxy = sem sync": conta sem
 * proxy sincroniza e publica normalmente pela Meta oficial.
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

// ── proxyInit ─────────────────────────────────────────────────────────────────

export function proxyInit(
  agent: ProxyAgent | null,
  base?: RequestInit
): RequestInit {
  if (!agent) return base ?? {};
  return { ...(base ?? {}), dispatcher: agent } as RequestInit;
}
