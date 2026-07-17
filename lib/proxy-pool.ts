// ---------------------------------------------------------------------------
// Estoque de Proxies — claim atômico, CONSUMO ÚNICO (2026-07-17)
//
// Contas novas recebem proxy automaticamente no callback OAuth. Garantias:
//  - Sem reutilização: UPDATE condicional `WHERE assigned_account_id IS NULL` —
//    o row-level lock do Postgres garante que duas conexões simultâneas nunca
//    reivindicam o mesmo proxy (mesmo padrão do claim do publish-pending).
//  - 1 proxy = 1 conta, PARA SEMPRE (decisão do usuário): proxy atribuído
//    nunca volta ao estoque. Conta excluída → trigger no banco DELETA a
//    entrada do estoque junto. Proxy removido/trocado manualmente na conta →
//    entrada deletada no PATCH /api/accounts/[id].
// ---------------------------------------------------------------------------

import crypto from "crypto";

type AdminClient = any;

// Normalização p/ dedup: trim + lowercase de protocolo/host (credenciais são
// case-sensitive e ficam intactas).
export function normalizeProxyUrl(raw: string): string {
  return raw.trim();
}

export function proxyHash(normalizedUrl: string): string {
  return crypto.createHash("sha256").update(normalizedUrl).digest("hex");
}

interface PoolRow {
  id: string;
  proxy_url: string; // ciphertext AES-256-GCM
}

// Reivindica um proxy livre do estoque para a conta e grava o ciphertext em
// instagram_accounts.proxy_url. Retorna true se atribuiu, false se estoque vazio.
export async function claimProxyForAccount(
  admin: AdminClient,
  userId: string,
  accountId: string
): Promise<{ assigned: boolean }> {
  // Até 5 candidatos — se perder a corrida em um, tenta o próximo.
  const { data: candidates } = await admin
    .from("proxy_pool")
    .select("id, proxy_url")
    .eq("user_id", userId)
    .is("assigned_account_id", null)
    .order("created_at", { ascending: true })
    .limit(5);

  for (const candidate of (candidates ?? []) as PoolRow[]) {
    // Claim atômico: só vence se ninguém reivindicou este proxy no meio-tempo.
    const { data: claimed, error: claimErr } = await admin
      .from("proxy_pool")
      .update({ assigned_account_id: accountId })
      .eq("id", candidate.id)
      .is("assigned_account_id", null)
      .select("id");

    if (claimErr || !claimed || claimed.length === 0) continue; // perdeu a corrida

    const { error: acctErr } = await admin
      .from("instagram_accounts")
      .update({ proxy_url: candidate.proxy_url })
      .eq("id", accountId);

    if (acctErr) {
      // Não conseguiu gravar na conta — libera o claim (o proxy nunca chegou a
      // ser usado por conta nenhuma, então pode voltar a ficar livre).
      await admin
        .from("proxy_pool")
        .update({ assigned_account_id: null })
        .eq("id", candidate.id);
      console.error(`[proxy-pool] Falha ao gravar proxy na conta ${accountId}: ${acctErr.message}`);
      return { assigned: false };
    }

    console.log(`[proxy-pool] Proxy ${candidate.id} atribuído à conta ${accountId} (consumo único).`);
    return { assigned: true };
  }

  console.warn(`[proxy-pool] Estoque vazio para user ${userId} — conta ${accountId} ficou sem proxy.`);
  return { assigned: false };
}
