// ---------------------------------------------------------------------------
// Estoque de Proxies — claim atômico (2026-07-17)
//
// Contas novas recebem proxy automaticamente no callback OAuth. Garantias:
//  - Sem reutilização: UPDATE condicional `WHERE assigned_account_id IS NULL` —
//    o row-level lock do Postgres garante que duas conexões simultâneas nunca
//    reivindicam o mesmo proxy (mesmo padrão do claim do publish-pending).
//  - Limpos primeiro: proxies devolvidos por contas excluídas (was_used=true)
//    só são redistribuídos quando os limpos acabarem (opção 2 do usuário —
//    IP de conta possivelmente banida é o último recurso).
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
  was_used: boolean;
}

// Reivindica um proxy livre do estoque para a conta e grava o ciphertext em
// instagram_accounts.proxy_url. Retorna true se atribuiu, false se estoque vazio.
export async function claimProxyForAccount(
  admin: AdminClient,
  userId: string,
  accountId: string
): Promise<{ assigned: boolean; wasUsed?: boolean }> {
  // Duas passadas: limpos primeiro, depois os devolvidos (was_used).
  for (const wantUsed of [false, true]) {
    // Até 5 candidatos por passada — se perder a corrida em um, tenta o próximo.
    const { data: candidates } = await admin
      .from("proxy_pool")
      .select("id, proxy_url, was_used")
      .eq("user_id", userId)
      .is("assigned_account_id", null)
      .eq("was_used", wantUsed)
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
        // Devolve o proxy ao estoque se não conseguiu gravar na conta.
        await admin
          .from("proxy_pool")
          .update({ assigned_account_id: null })
          .eq("id", candidate.id);
        console.error(`[proxy-pool] Falha ao gravar proxy na conta ${accountId}: ${acctErr.message}`);
        return { assigned: false };
      }

      console.log(
        `[proxy-pool] Proxy ${candidate.id} (${wantUsed ? "reutilizado" : "limpo"}) ` +
        `atribuído à conta ${accountId}.`
      );
      return { assigned: true, wasUsed: wantUsed };
    }
  }

  console.warn(`[proxy-pool] Estoque vazio para user ${userId} — conta ${accountId} ficou sem proxy.`);
  return { assigned: false };
}
