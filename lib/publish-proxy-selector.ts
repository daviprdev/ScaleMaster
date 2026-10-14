// Round-robin por usuário para cada publicação. O avanço é atômico no
// PostgreSQL; retries recebem o mesmo proxy pelo poolId persistido no post.

import { ProxyAgent } from "undici";
import { decrypt } from "@/lib/encrypt";

type AdminClient = any;

export interface SelectedProxy {
  poolId: string;
  agent: ProxyAgent;
  safeLabel: string;
}

interface FreeProxyRow {
  id: string;
  proxy_url: string;
  proxy_hash: string;
}

/**
 * Selects the next free proxy for a new publication, or reuses the persisted
 * proxy for a retry. Returns null when no eligible/decryptable proxy exists.
 */
export async function selectProxyForPublish(
  admin: AdminClient,
  userId: string,
  postId: string,
  preferredPoolId?: string | null
): Promise<SelectedProxy | null> {
  const createSelected = (candidate: FreeProxyRow): SelectedProxy | null => {
    let plainUrl: string;
    try {
      plainUrl = decrypt(candidate.proxy_url);
    } catch {
      console.warn(`[publish-proxy] Proxy ${candidate.id.slice(0, 8)} não pôde ser descriptografado.`);
      return null;
    }

    const safeLabel = candidate.proxy_hash?.slice(0, 12) || candidate.id.slice(0, 12);
    console.log(`[publish-proxy] post=${postId.slice(0, 8)}… → proxy ${safeLabel}…`);
    return { poolId: candidate.id, agent: new ProxyAgent(plainUrl), safeLabel };
  };

  // Reuse the proxy already assigned to this publication on poll/retry.
  if (preferredPoolId) {
    const { data, error } = await admin
      .from("proxy_pool")
      .select("id, proxy_url, proxy_hash")
      .eq("id", preferredPoolId)
      .eq("user_id", userId)
      .is("assigned_account_id", null)
      .maybeSingle();
    if (!error && data) {
      const selected = createSelected(data as FreeProxyRow);
      if (selected) return selected;
    }
  }

  // New publication, removed/assigned proxy, or a proxy that cannot be
  // decrypted: atomically try the next least recently used free proxy.
  for (let attempt = 0; attempt < 3; attempt++) {
    const { data, error } = await admin.rpc("claim_next_publish_proxy", {
      p_user_id: userId,
    });
    if (error) {
      console.error(`[publish-proxy] Falha ao selecionar proxy para post ${postId.slice(0, 8)}: ${error.message}`);
      return null;
    }
    const row = Array.isArray(data) ? data[0] : data;
    if (!row) break;
    const selected = createSelected(row as FreeProxyRow);
    if (selected) return selected;
  }

  return null;
}

/** Closes a ProxyAgent safely. Call in finally blocks after use. */
export async function closeProxyAgent(proxy: SelectedProxy | null): Promise<void> {
  if (!proxy) return;
  try {
    await proxy.agent.close();
  } catch {
    // Best-effort cleanup.
  }
}
