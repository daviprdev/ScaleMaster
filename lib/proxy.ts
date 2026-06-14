/**
 * lib/proxy.ts — Proxy residencial por conta para chamadas à Meta Graph API.
 *
 * Prioridade:
 *   1. instagram_accounts.proxy_url (AES-256-GCM) → proxy dedicado individual
 *   2. PROXY_URL_TEMPLATE env var           → proxy por sessão (Smartproxy sticky)
 *   3. null                                 → sem proxy (IP Vercel)
 *
 * ── Como configurar com Smartproxy ──────────────────────────────────────────
 *
 * No painel Smartproxy → Residential Proxies → Endpoint Generator:
 *   Escolha: Sticky Session | País: BR | Duration: 720 min
 *
 * Formato da URL (copie do painel e substitua apenas {SESSION}):
 *   http://USERNAME_country-BR_session-{SESSION}:PASSWORD@gate.smartproxy.com:7000
 *
 * Adicione como env var PROXY_URL_TEMPLATE na Vercel:
 *   http://smart-xxxxx_country-BR_session-{SESSION}:SENHA@gate.smartproxy.com:7000
 *
 * Regras CRÍTICAS:
 *   - {SESSION} é o ÚNICO placeholder — username e password devem ser literais
 *   - NÃO use {user}, {pass}, {username}, {password} — a URL ficaria inválida
 *   - Teste com o endpoint de diagnóstico: /dashboard/proxy-test
 *
 * Cada conta recebe um session_id determinístico (SHA-256 do account_id, 8 hex)
 * → mesmo account_id = mesmo session_id = mesmo IP residencial por 12h.
 */

import { createHash } from "crypto";
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

// ── Session ID determinístico por account ────────────────────────────────────

function sessionForAccount(accountId: string): string {
  return createHash("sha256").update(accountId).digest("hex").slice(0, 8);
}

// ── getProxyForAccount ────────────────────────────────────────────────────────

/**
 * Retorna um ProxyAgent para a conta, ou null se nenhum proxy estiver configurado.
 *
 * Ordem de prioridade:
 *   1. proxy_url individual no banco (AES-256-GCM)
 *   2. PROXY_URL_TEMPLATE com session derivada do account_id
 *   3. null → IP da Vercel (sem proxy)
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

  // 2. Template global (Smartproxy sticky session por account)
  const template = process.env.PROXY_URL_TEMPLATE;
  if (template) {
    if (!template.includes("{SESSION}")) {
      // Log apenas na primeira chamada (evita spam nos logs do cron)
      console.warn("[proxy] PROXY_URL_TEMPLATE não contém {SESSION} — template ignorado.");
    } else {
      const session = sessionForAccount(accountId);
      const rawUrl  = template.replace("{SESSION}", session);
      const agent   = buildProxyAgent(rawUrl, accountId);
      if (agent) {
        console.log(
          `[proxy] ${accountId.slice(0, 8)}… → template (sessão ${session}) | ${proxyLabels.get(agent)}`
        );
        return agent;
      }
    }
  }

  // 3. Sem proxy
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
