/**
 * /api/cron/sync-accounts
 *
 * Sincroniza perfis de TODAS as contas de TODOS os usuários em background.
 * Roda a cada 1 min (vercel.json) e só pega contas paradas há mais de STALE_MINUTES,
 * ordenadas da mais velha pra mais nova — refresca o painel sozinho (~5 min de
 * frescor) sem sincronizar todas de uma vez (anti-burst / anti-checkpoint).
 *
 * Lógica:
 *   - Busca contas com profile_refreshed_at IS NULL ou > STALE_MINUTES atrás
 *   - Processa em lotes de 3 com 2s de delay entre lotes (anti-rate-limit)
 *   - Erros de token genuíno: marca health_status='error' + registra em failover_logs
 *   - Erros de infra/rede/proxy: loga e segue (não marca como error)
 *   - Cascata (≥70% & ≥5 contas): não marca nenhuma — é problema no App/Meta
 */

import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { refreshMetaToken } from "@/lib/meta-refresh";
import { fetch as undiciFetch } from "undici";
import { getProxyForAccount, proxyInit, isProxyNetworkError, recordProxyFailure } from "@/lib/proxy";

export const runtime = "nodejs";
export const maxDuration = 300;

const GRAPH = "https://graph.instagram.com/v21.0";
const STALE_MINUTES = 5; // painel quase ao vivo — o cron roda a cada 1 min e só pega contas paradas há mais de 5 min (ritmo natural ~14 contas/min, sem burst)
const STALE_MS = STALE_MINUTES * 60 * 1000;

// ── Proteção anti-checkpoint para contas recém-conectadas ──────────────────
// Contas novas (especialmente recém-criadas no Instagram) estão na janela mais
// sensível do risk engine da Meta. O callback OAuth não grava profile_refreshed_at,
// então a conta nova entrava no TOPO da fila (nullsFirst) e era pingada já no
// primeiro minuto + a cada 5 min — padrão robótico de IP datacenter que derrubava
// contas em checkpoint ~30 min após conectar, sem nunca ter postado (2026-07-15).
// Regra: primeiras SYNC só após 30 min de conexão; nas primeiras 24h, no máximo
// 1 sync por hora. Depois de 24h, cadência normal de 5 min.
const NEW_ACCOUNT_FIRST_SYNC_MS = 30 * 60 * 1000; // 30 min sem NENHUM sync após conectar
const NEW_ACCOUNT_AGE_MS = 24 * 60 * 60 * 1000;   // considera "nova" por 24h
const NEW_ACCOUNT_STALE_MS = 60 * 60 * 1000;      // cadência de 1h durante as 24h iniciais
const BATCH_SIZE = 3;
const BATCH_DELAY_MS = 2_000;
const TOKEN_ERROR_CODES = new Set([190, 102, 104]);
const CASCADE_THRESHOLD = 0.7;
const MIN_CASCADE_COUNT = 5;

const META_INFRA_MESSAGES = [
  "failed to decrypt",
  "cannot parse access token",
  "malformed access token",
  "could not decrypt",
];

// Checkpoint do Instagram: a conta caiu e exige login manual via browser para
// voltar. Não é transitório do ponto de vista do painel — a conta não posta e
// não sincroniza até o usuário resolver. Deve ficar VERMELHA imediatamente
// (mesmo comportamento do refresh manual), sem tentar renovar token (renovação
// não resolve checkpoint).
const CHECKPOINT_MESSAGES = [
  "you cannot access the app till you log in",
  "log in to www.instagram.com and follow the instructions",
];

interface AccountRow {
  id: string;
  username: string;
  user_id: string;
  ig_business_account_id: string;
  meta_access_token: string;
  fb_page_id: string | null;
  proxy_url: string | null;
  connected_at: string | null;
  profile_refreshed_at: string | null;
}

function isMetaInfraError(code: number, message: string): boolean {
  if (code !== 190) return false;
  const lower = message.toLowerCase();
  return META_INFRA_MESSAGES.some(p => lower.includes(p));
}

function isCheckpointError(code: number, message: string): boolean {
  if (code !== 190) return false;
  const lower = message.toLowerCase();
  return CHECKPOINT_MESSAGES.some(p => lower.includes(p));
}

async function syncOne(acc: AccountRow, admin: ReturnType<typeof getSupabaseAdmin>) {
  let activeToken = acc.meta_access_token;
  const proxy = getProxyForAccount(acc.id, acc.proxy_url);

  // Política sem-proxy = sem-sync (2026-07-15): nenhuma requisição de sync sai
  // pelo IP da Vercel. Se a conta não tem proxy (ou o decrypt/URL falhou), pula
  // o ciclo em silêncio — sem marcar erro. Mesma regra do pipeline de postagem.
  if (!proxy) {
    console.warn(`[cron/sync-accounts] @${acc.username} sem proxy utilizável — sync pulado.`);
    return { id: acc.id, user_id: acc.user_id, ok: false };
  }

  const fetchProfile = async (token: string) => {
    const url =
      `${GRAPH}/${acc.ig_business_account_id}` +
      `?fields=followers_count,media_count,name,profile_picture_url` +
      `&access_token=${encodeURIComponent(token)}`;
    try {
      const res = await undiciFetch(url, proxyInit(proxy, { signal: AbortSignal.timeout(15_000) }) as any);
      return (await res.json()) as Record<string, unknown>;
    } catch (err) {
      // Proxy morto → NÃO cai para IP Vercel. Registra a falha (ProxyOutageBanner)
      // e pula o ciclo — a conta tenta de novo no próximo sync.
      const msg = (err as Error).message ?? String(err);
      if (isProxyNetworkError(msg)) {
        await recordProxyFailure(admin, acc.id, "cron/sync-accounts", msg);
      }
      throw err;
    }
  };

  try {
    let data = await fetchProfile(activeToken);

    if (data.error) {
      const err = data.error as { code: number; message: string };

      // Checkpoint = conta caída de verdade → marca vermelho direto,
      // igual ao refresh manual. Renovar token não resolve checkpoint.
      if (isCheckpointError(err.code, err.message)) {
        console.warn(`[cron/sync-accounts] 🔴 Checkpoint @${acc.username} — marcando como error`);
        return { id: acc.id, user_id: acc.user_id, ok: false, tokenError: true, errorCode: err.code, errorMessage: err.message };
      }

      if (isMetaInfraError(err.code, err.message)) {
        console.warn(`[cron/sync-accounts] ⚠️ Infra error @${acc.username} (code=${err.code}) — transitório, ignorado`);
        return { id: acc.id, user_id: acc.user_id, ok: false, infraError: true };
      }

      if (TOKEN_ERROR_CODES.has(err.code)) {
        // Tenta renovar antes de marcar como error
        try {
          const { token: newToken, expiresAt } = await refreshMetaToken(activeToken, acc.fb_page_id, proxy);
          await admin.from("instagram_accounts")
            .update({ meta_access_token: newToken, token_expires_at: expiresAt.toISOString() })
            .eq("id", acc.id);
          activeToken = newToken;
          data = await fetchProfile(newToken);
          if (data.error) {
            const err2 = data.error as { code: number; message: string };
            return { id: acc.id, user_id: acc.user_id, ok: false, tokenError: TOKEN_ERROR_CODES.has(err2.code), errorCode: err2.code, errorMessage: err2.message };
          }
          console.log(`[cron/sync-accounts] ✓ Token renovado @${acc.username}`);
        } catch (refreshErr) {
          const msg = (refreshErr instanceof Error ? refreshErr.message : String(refreshErr)).toLowerCase();
          const isNetwork = ["fetch failed","econnreset","timeout","socket","proxy","smartproxy","network"].some(p => msg.includes(p));
          return { id: acc.id, user_id: acc.user_id, ok: false, tokenError: !isNetwork, errorCode: err.code, errorMessage: err.message };
        }
      } else {
        return { id: acc.id, user_id: acc.user_id, ok: false, tokenError: false, errorCode: err.code, errorMessage: err.message };
      }
    }

    // Último post (não crítico). Pulado em contas < 24h: corta pela metade as
    // requisições na janela mais sensível a checkpoint.
    let lastPostAt: string | null = null;
    const isNewAccount = acc.connected_at &&
      Date.now() - new Date(acc.connected_at).getTime() < NEW_ACCOUNT_AGE_MS;
    if (!isNewAccount) try {
      const mediaRes = await undiciFetch(
        `${GRAPH}/${acc.ig_business_account_id}/media?fields=timestamp&limit=1&access_token=${encodeURIComponent(activeToken)}`,
        proxyInit(proxy, { signal: AbortSignal.timeout(10_000) }) as any
      );
      const mediaData = (await mediaRes.json()) as { data?: Array<{ timestamp: string }> };
      lastPostAt = mediaData.data?.[0]?.timestamp ?? null;
    } catch { /* non-critical */ }

    const update: Record<string, unknown> = {
      followers_count: (data.followers_count as number) ?? 0,
      posts_count: (data.media_count as number) ?? 0,
      profile_refreshed_at: new Date().toISOString(),
    };
    if (lastPostAt) update.last_post_at = lastPostAt;
    if (data.name) update.display_name = data.name as string;
    if (data.profile_picture_url) update.avatar_url = data.profile_picture_url as string;

    await admin.from("instagram_accounts").update(update).eq("id", acc.id);
    return { id: acc.id, user_id: acc.user_id, ok: true };
  } catch (err) {
    console.error(`[cron/sync-accounts] Erro inesperado @${acc.username}:`, err);
    return { id: acc.id, user_id: acc.user_id, ok: false };
  }
}

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = getSupabaseAdmin();

  const cutoff = new Date(Date.now() - STALE_MS).toISOString();
  const { data: accounts, error } = await admin
    .from("instagram_accounts")
    .select("id, username, user_id, ig_business_account_id, meta_access_token, fb_page_id, proxy_url, connected_at, profile_refreshed_at")
    .neq("health_status", "error")
    .not("ig_business_account_id", "is", null)
    .not("meta_access_token", "is", null)
    // Sem proxy = sem sync: contas sem proxy dedicado ficam fora da fila —
    // nenhuma requisição em nome delas sai pelo IP datacenter da Vercel.
    .not("proxy_url", "is", null)
    .or(`profile_refreshed_at.is.null,profile_refreshed_at.lte.${cutoff}`)
    .order("profile_refreshed_at", { ascending: true, nullsFirst: true })
    .limit(200);

  if (error) {
    console.error("[cron/sync-accounts] Erro ao buscar contas:", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Cadência reduzida para contas recém-conectadas (anti-checkpoint)
  const nowMs = Date.now();
  const eligible = ((accounts ?? []) as unknown as AccountRow[]).filter((a) => {
    if (!a.connected_at) return true;
    const ageMs = nowMs - new Date(a.connected_at).getTime();
    if (ageMs >= NEW_ACCOUNT_AGE_MS) return true; // conta madura → cadência normal
    if (ageMs < NEW_ACCOUNT_FIRST_SYNC_MS) {
      console.log(`[cron/sync-accounts] @${a.username} conectada há ${Math.round(ageMs / 60_000)}min — grace inicial (30min), pulando.`);
      return false;
    }
    if (!a.profile_refreshed_at) return true; // primeira sync após o grace inicial
    const staleMs = nowMs - new Date(a.profile_refreshed_at).getTime();
    if (staleMs < NEW_ACCOUNT_STALE_MS) {
      return false; // conta nova sincronizada há < 1h → aguarda
    }
    return true;
  });

  if (eligible.length === 0) {
    return NextResponse.json({ synced: 0, message: "Nenhuma conta desatualizada." });
  }

  console.log(`[cron/sync-accounts] ${eligible.length} contas desatualizadas (>${STALE_MINUTES}min)`);

  const results: Awaited<ReturnType<typeof syncOne>>[] = [];
  const startedAt = Date.now();
  const RUN_BUDGET_MS = 260_000;

  for (let i = 0; i < eligible.length; i += BATCH_SIZE) {
    if (Date.now() - startedAt > RUN_BUDGET_MS) break;
    const batch = eligible.slice(i, i + BATCH_SIZE);
    const settled = await Promise.allSettled(batch.map(acc => syncOne(acc, admin)));
    for (const s of settled) {
      if (s.status === "fulfilled") results.push(s.value);
    }
    if (i + BATCH_SIZE < eligible.length) {
      await new Promise(r => setTimeout(r, BATCH_DELAY_MS));
    }
  }

  // Cascade detection — não marca ninguém se for problema do App/Meta.
  // O denominador é o TOTAL de contas ativas, não o lote stale deste run:
  // contas mortas nunca têm profile_refreshed_at atualizado, então o lote stale
  // degenera para "só as mortas" em poucos minutos — medir a cascata contra ele
  // dispara falso positivo todo run e nenhuma conta é marcada nunca (sync congela
  // sem ficar vermelho até um sync manual forçado). Cascata real da Meta derruba
  // a maioria das contas ATIVAS, então é isso que deve ser medido.
  const { count: totalActive } = await admin
    .from("instagram_accounts")
    .select("id", { count: "exact", head: true })
    .neq("health_status", "error")
    .not("ig_business_account_id", "is", null)
    .not("meta_access_token", "is", null);
  const cascadeBase = Math.max(totalActive ?? 0, results.length);

  const tokenErrorResults = results.filter(r => (r as any).tokenError);
  const isCascade =
    tokenErrorResults.length >= MIN_CASCADE_COUNT &&
    tokenErrorResults.length >= Math.ceil(cascadeBase * CASCADE_THRESHOLD);

  if (isCascade) {
    console.warn(`[cron/sync-accounts] CASCATA: ${tokenErrorResults.length}/${cascadeBase} contas ativas com token error — nenhuma conta marcada.`);
    return NextResponse.json({ synced: 0, cascade: true, token_errors: tokenErrorResults.length });
  }

  // Escrita individual dos erros confirmados
  let synced = 0;
  let tokenErrors = 0;
  await Promise.allSettled(results.map(async r => {
    if ((r as any).ok) { synced++; return; }
    if ((r as any).tokenError) {
      tokenErrors++;
      await admin.from("instagram_accounts")
        .update({ health_status: "error", profile_refreshed_at: new Date().toISOString() })
        .eq("id", r.id);
      await admin.from("failover_logs").insert({
        user_id: r.user_id,
        failed_account_id: r.id,
        backup_account_id: null,
        error_reason: `[cron/sync-accounts] code=${(r as any).errorCode} — ${(r as any).errorMessage}`,
      });
    }
  }));

  console.log(`[cron/sync-accounts] ✓ synced=${synced} token_errors=${tokenErrors} total=${results.length}`);
  return NextResponse.json({ synced, token_errors: tokenErrors, total: results.length });
}
