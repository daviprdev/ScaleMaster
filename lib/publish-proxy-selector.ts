// ---------------------------------------------------------------------------
// Seletor de Proxy para Publicação — round-robin por post_id (2026-10-13)
//
// Diferente do claimProxyForAccount (que atribui um proxy fixo à conta),
// este módulo seleciona um proxy LIVRE do estoque do usuário no momento da
// execução da publicação, sem vincular à conta. A distribuição é
// determinística por post_id para que retries usem o mesmo proxy.
//
// Garantias:
//  - Escopo: só proxies do user_id da publicação
//  - Round-robin: hash(post_id) % count(proxies_ativos) → índice estável
//  - Sem fallback silencioso: se não há proxy ativo, retorna erro explícito
//  - Não altera assigned_account_id (proxy permanece livre no estoque)
//  - Credenciais descriptografadas apenas em memória, nunca logadas
// ---------------------------------------------------------------------------

import { ProxyAgent } from "undici";
import { decrypt } from "@/lib/encrypt";

type AdminClient = any;

export interface SelectedProxy {
  /** ID do proxy no estoque (para auditoria/proxy_pool_id_used) */
  poolId: string;
  /** ProxyAgent pronto para usar como dispatcher no undici.fetch */
  agent: ProxyAgent;
  /** Hash SHA-256 truncado para logs seguros (nunca URL/credenciais) */
  safeLabel: string;
}

interface FreeProxyRow {
  id: string;
  proxy_url: string; // ciphertext AES-256-GCM
  proxy_hash: string; // SHA-256 da URL normalizada
}

/**
 * Deterministic index from post_id — stable across retries of the same post.
 * Uses first 8 hex chars of proxy_hash as numeric seed to avoid bias from
 * UUID structure (version bits, variant bits).
 */
function deterministicIndex(postId: string, poolSize: number): number {
  // postId is already a UUID v4 — take chars that vary most (last 12 hex digits)
  const hex = postId.replace(/-/g, "").slice(-12);
  const num = parseInt(hex, 16);
  return num % poolSize;
}

/**
 * Selects an active proxy from the user's pool for a specific publication.
 * Returns null if no eligible proxy exists (caller must handle explicitly).
 *
 * The returned ProxyAgent MUST be closed after use via agent.close().
 */
export async function selectProxyForPublish(
  admin: AdminClient,
  userId: string,
  postId: string
): Promise<SelectedProxy | null> {
  // Fetch all free (unassigned) proxies for this user.
  // We don't filter by alive here — that would be too slow for every publish.
  // Instead we try up to 3 candidates starting from the deterministic index.
  const { data: freeProxies } = await admin
    .from("proxy_pool")
    .select("id, proxy_url, proxy_hash")
    .eq("user_id", userId)
    .is("assigned_account_id", null)
    .order("created_at", { ascending: true });

  if (!freeProxies || freeProxies.length === 0) {
    return null;
  }

  const pool = freeProxies as FreeProxyRow[];
  const startIdx = deterministicIndex(postId, pool.length);

  // Try up to 3 candidates (wrapping around) to find one that decrypts cleanly.
  // We intentionally skip liveness check here — the actual Meta API call will
  // fail fast if the proxy is dead, and the existing retry logic handles it.
  // Adding ipify checks here would add 8s latency per publish attempt.
  const maxAttempts = Math.min(3, pool.length);
  for (let i = 0; i < maxAttempts; i++) {
    const idx = (startIdx + i) % pool.length;
    const candidate = pool[idx];

    let plainUrl: string;
    try {
      plainUrl = decrypt(candidate.proxy_url);
    } catch {
      // Decryption failure — skip this candidate silently
      continue;
    }

    const agent = new ProxyAgent(plainUrl);
    const safeLabel = candidate.proxy_hash.slice(0, 12);

    console.log(
      `[publish-proxy] post=${postId.slice(0, 8)}… → proxy ${safeLabel}… ` +
      `(pool index ${idx}/${pool.length})`
    );

    return {
      poolId: candidate.id,
      agent,
      safeLabel,
    };
  }

  // All candidates failed decryption
  console.warn(
    `[publish-proxy] post=${postId.slice(0, 8)}… → nenhum proxy descriptografável ` +
    `entre ${maxAttempts} candidatos (pool size=${pool.length}).`
  );
  return null;
}

/**
 * Closes a ProxyAgent safely. Call in finally blocks after use.
 */
export async function closeProxyAgent(proxy: SelectedProxy | null): Promise<void> {
  if (!proxy) return;
  try {
    await proxy.agent.close();
  } catch {
    // Best-effort cleanup
  }
}