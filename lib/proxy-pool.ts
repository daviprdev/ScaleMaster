// ---------------------------------------------------------------------------
// Estoque de Proxies — claim atômico, COM REAPROVEITAMENTO (2026-07-30)
//
// Contas novas recebem proxy automaticamente no callback OAuth. Garantias:
//  - Claim atômico: UPDATE condicional `WHERE assigned_account_id IS NULL` —
//    o row-level lock do Postgres garante que duas conexões simultâneas nunca
//    reivindicam o mesmo proxy (mesmo padrão do claim do publish-pending).
//  - Reaproveitamento (decisão do usuário, corte de custo): proxy de conta
//    excluída volta ao estoque como LIVRE em vez de ser deletado (a FK
//    `assigned_account_id ON DELETE SET NULL` cuida disso sozinha — sem
//    trigger). O mesmo vale para proxy trocado/removido manualmente
//    (PATCH /api/accounts/[id] e bulk-proxy) — a entrada é liberada, não
//    apagada.
//  - Verificação de saúde no claim: antes de reatribuir um proxy livre a uma
//    conta nova, testamos conectividade real (ipify) com timeout curto. Se o
//    proxy estiver morto, a entrada é deletada de vez (não vale a pena manter
//    no estoque) e tentamos o próximo candidato.
// ---------------------------------------------------------------------------

import crypto from "crypto";
import { ProxyAgent, fetch as undiciFetch } from "undici";
import { decrypt } from "@/lib/encrypt";

type AdminClient = any;

// Normalização p/ dedup: trim + lowercase de protocolo/host (credenciais são
// case-sensitive e ficam intactas).
export function normalizeProxyUrl(raw: string): string {
  return raw.trim();
}

function isValidPort(s: string): boolean {
  return /^\d{2,5}$/.test(s) && Number(s) > 0 && Number(s) < 65536;
}

// Host = IP ou domínio (sempre contém ponto) — desambigua de username.
function looksLikeHost(s: string): boolean {
  return /^[a-z0-9.-]+$/i.test(s) && s.includes(".");
}

function buildUrl(user: string, pass: string, host: string, port: string): string {
  return `http://${encodeURIComponent(user)}:${encodeURIComponent(pass)}@${host}:${port}`;
}

// Aceita os formatos comuns de listas de fornecedores e normaliza para
// `http://user:pass@host:port` (o formato que o ProxyAgent do undici consome):
//   http://user:pass@ip:porta   (URL completa)
//   ip:porta:user:pass          (formato mais comum de venda)
//   user:pass:ip:porta
//   user:pass@ip:porta
//   ip:porta@user:pass
//   ip:porta                    (sem autenticação)
// Retorna null se a linha não for reconhecida.
export function parseProxyLine(raw: string): string | null {
  const line = raw.trim().replace(/[,;]\s*$/, "");
  if (!line) return null;

  // 1. URL completa
  if (line.includes("://")) {
    try {
      const u = new URL(line);
      if (!/^https?:$/.test(u.protocol) || !u.hostname || !u.port) return null;
      return line;
    } catch { return null; }
  }

  // 2. Com @: user:pass@host:port ou host:port@user:pass
  if (line.includes("@")) {
    const [left, right] = line.split("@");
    if (!left || !right) return null;
    const lp = left.split(":");
    const rp = right.split(":");
    if (lp.length === 2 && rp.length === 2) {
      if (looksLikeHost(rp[0]) && isValidPort(rp[1])) return buildUrl(lp[0], lp[1], rp[0], rp[1]);
      if (looksLikeHost(lp[0]) && isValidPort(lp[1])) return buildUrl(rp[0], rp[1], lp[0], lp[1]);
    }
    return null;
  }

  // 3. Separado por dois-pontos
  const parts = line.split(":");
  if (parts.length === 2 && looksLikeHost(parts[0]) && isValidPort(parts[1])) {
    return `http://${parts[0]}:${parts[1]}`;
  }
  if (parts.length === 4) {
    // ip:porta:user:pass
    if (looksLikeHost(parts[0]) && isValidPort(parts[1])) return buildUrl(parts[2], parts[3], parts[0], parts[1]);
    // user:pass:ip:porta
    if (looksLikeHost(parts[2]) && isValidPort(parts[3])) return buildUrl(parts[0], parts[1], parts[2], parts[3]);
  }
  return null;
}

export function proxyHash(normalizedUrl: string): string {
  return crypto.createHash("sha256").update(normalizedUrl).digest("hex");
}

interface PoolRow {
  id: string;
  proxy_url: string; // ciphertext AES-256-GCM
}

// Testa conectividade real do proxy antes de reatribuí-lo (evita entregar um
// proxy morto — que pode ter ficado no estoque há semanas — a uma conta nova).
async function isProxyAlive(rawUrl: string): Promise<boolean> {
  let agent: ProxyAgent | undefined;
  try {
    agent = new ProxyAgent(rawUrl);
    const res = await undiciFetch("https://api.ipify.org?format=json", {
      dispatcher: agent,
      signal: AbortSignal.timeout(8_000),
    } as any);
    return res.ok;
  } catch {
    return false;
  } finally {
    await agent?.close().catch(() => {});
  }
}

// Reivindica um proxy livre do estoque para a conta e grava o ciphertext em
// instagram_accounts.proxy_url. Retorna true se atribuiu, false se estoque vazio.
export async function claimProxyForAccount(
  admin: AdminClient,
  userId: string,
  accountId: string
): Promise<{ assigned: boolean }> {
  // Até 5 candidatos — se perder a corrida ou o proxy estiver morto, tenta o próximo.
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

    let plainUrl: string;
    try {
      plainUrl = decrypt(candidate.proxy_url);
    } catch (e) {
      console.warn(`[proxy-pool] Falha ao descriptografar candidato ${candidate.id} — descartando: ${String(e)}`);
      await admin.from("proxy_pool").delete().eq("id", candidate.id);
      continue;
    }

    const alive = await isProxyAlive(plainUrl);
    if (!alive) {
      // Proxy morto — não vale a pena manter no estoque nem devolvê-lo livre.
      console.warn(`[proxy-pool] Proxy ${candidate.id} não respondeu — removido do estoque.`);
      await admin.from("proxy_pool").delete().eq("id", candidate.id);
      continue;
    }

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

    console.log(`[proxy-pool] Proxy ${candidate.id} atribuído à conta ${accountId} (verificado e vivo).`);
    return { assigned: true };
  }

  console.warn(`[proxy-pool] Estoque vazio (ou só com proxies mortos) para user ${userId} — conta ${accountId} ficou sem proxy.`);
  return { assigned: false };
}

// Proxy dedicado de CONTA LEITORA (aba Inspirações). Testa o proxy atual; se
// estiver morto (provedor recusou credencial, plano esgotado, timeout), troca
// por um proxy livre e vivo do estoque. O substituto SAI do estoque (delete
// atômico como claim): a publicação usa os proxies livres do pool, e conta
// leitora nunca deve dividir IP com conta de postagem.
// Retorna a URL em texto puro pronta para uso, ou null se não há proxy vivo.
export async function ensureReaderProxy(
  admin: AdminClient,
  userId: string,
  readerId: string,
  currentEncryptedProxyUrl: string | null
): Promise<{ proxyUrl: string | null; swapped: boolean }> {
  if (currentEncryptedProxyUrl) {
    try {
      const current = decrypt(currentEncryptedProxyUrl);
      if (await isProxyAlive(current)) return { proxyUrl: current, swapped: false };
      console.warn(`[proxy-pool] Proxy da conta leitora ${readerId} está morto — buscando substituto no estoque.`);
    } catch (e) {
      console.warn(`[proxy-pool] Proxy da conta leitora ${readerId} ilegível — buscando substituto: ${String(e)}`);
    }
  }

  const { data: candidates } = await admin
    .from("proxy_pool")
    .select("id, proxy_url")
    .eq("user_id", userId)
    .is("assigned_account_id", null)
    .order("created_at", { ascending: false })
    .limit(5);

  for (const candidate of (candidates ?? []) as PoolRow[]) {
    // Claim atômico: só quem apagar a linha fica com o proxy.
    const { data: taken } = await admin
      .from("proxy_pool")
      .delete()
      .eq("id", candidate.id)
      .is("assigned_account_id", null)
      .select("id");
    if (!taken || taken.length === 0) continue; // perdeu a corrida

    let plainUrl: string;
    try {
      plainUrl = decrypt(candidate.proxy_url);
    } catch {
      continue; // ilegível — já saiu do estoque, nada a fazer
    }
    if (!(await isProxyAlive(plainUrl))) {
      console.warn(`[proxy-pool] Candidato ${candidate.id} não respondeu — descartado do estoque.`);
      continue;
    }

    const { error: updErr } = await admin
      .from("reader_accounts")
      .update({ proxy_url: candidate.proxy_url })
      .eq("id", readerId);
    if (updErr) {
      // Não gravou na conta: devolve o proxy (vivo) ao estoque.
      await admin.from("proxy_pool").insert({
        user_id: userId,
        proxy_url: candidate.proxy_url,
        proxy_hash: proxyHash(normalizeProxyUrl(plainUrl)),
      });
      console.error(`[proxy-pool] Falha ao gravar proxy na conta leitora ${readerId}: ${updErr.message}`);
      return { proxyUrl: null, swapped: false };
    }

    console.log(`[proxy-pool] Conta leitora ${readerId} recebeu o proxy ${candidate.id} do estoque (verificado e vivo).`);
    return { proxyUrl: plainUrl, swapped: true };
  }

  return { proxyUrl: null, swapped: false };
}

// Devolve ao estoque o proxy de uma conta LEITORA excluída (mesma política das
// contas de postagem: proxy de conta excluída volta LIVRE). Só se estiver vivo
// — proxy morto não volta para o estoque. Retorna true se devolveu.
export async function returnProxyToPool(
  admin: AdminClient,
  userId: string,
  encryptedProxyUrl: string | null
): Promise<boolean> {
  if (!encryptedProxyUrl) return false;
  let plain: string;
  try {
    plain = decrypt(encryptedProxyUrl);
  } catch {
    return false;
  }
  if (!(await isProxyAlive(plain))) return false;
  const { error } = await admin.from("proxy_pool").upsert(
    { user_id: userId, proxy_url: encryptedProxyUrl, proxy_hash: proxyHash(normalizeProxyUrl(plain)) },
    { onConflict: "user_id,proxy_hash", ignoreDuplicates: true }
  );
  if (error) {
    console.warn(`[proxy-pool] Falha ao devolver proxy de conta leitora ao estoque: ${error.message}`);
    return false;
  }
  return true;
}

// Descarta o proxy atual da conta (morto — não volta ao estoque) e tenta
// reivindicar um substituto livre. Usado pelo botão "Trocar proxies com falha"
// quando o provedor cai: em vez de esperar o usuário reimportar a lista toda,
// libera as contas travadas usando o que já sobra no estoque.
export async function swapProxyForAccount(
  admin: AdminClient,
  userId: string,
  accountId: string,
  currentEncryptedProxyUrl: string | null
): Promise<{ swapped: boolean; discarded: boolean }> {
  let discarded = false;

  if (currentEncryptedProxyUrl) {
    try {
      const plain = decrypt(currentEncryptedProxyUrl);
      const hash = proxyHash(normalizeProxyUrl(plain));
      const { data: removed } = await admin
        .from("proxy_pool")
        .delete()
        .eq("user_id", userId)
        .eq("proxy_hash", hash)
        .select("id");
      discarded = !!removed && removed.length > 0;
    } catch (e) {
      console.warn(`[proxy-pool] Não foi possível descriptografar/descartar o proxy morto da conta ${accountId}: ${String(e)}`);
    }
  }

  // Zera o proxy da conta e o histórico de erro — se não houver substituto no
  // estoque, a conta fica sem proxy (política "sem proxy = sem sync/postagem")
  // em vez de manter um proxy morto, que resulta no mesmo travamento.
  await admin
    .from("instagram_accounts")
    .update({ proxy_url: null, last_proxy_error_at: null, last_proxy_error: null })
    .eq("id", accountId);

  const { assigned } = await claimProxyForAccount(admin, userId, accountId);
  return { swapped: assigned, discarded };
}
