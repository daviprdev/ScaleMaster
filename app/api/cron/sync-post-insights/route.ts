/**
 * /api/cron/sync-post-insights
 *
 * Sincroniza métricas (views/reach/likes/comments/shares/saved) de TODOS os
 * posts publicados, em background, alimentando o total de views da Dashboard.
 *
 * Duas origens:
 *   - scheduled_posts    → Postar / Clonar / Stories
 *   - pending_containers → Loop
 * Antes só a primeira era sincronizada: posts do Loop só ganhavam views quando
 * alguém abria o analytics daquele loop, e ficavam congelados no valor lido
 * minutos após publicar.
 *
 * Cadência por idade (as views crescem rápido no começo e estabilizam depois):
 *   Reel  < 2 dias    → a cada 4h
 *   Reel  2–14 dias   → a cada 24h
 *   Reel  14–60 dias  → a cada 7 dias
 *   Reel  > 60 dias   → não atualiza mais
 *   Story < 26h       → a cada 1h (a Meta só expõe insights de story ativo)
 *   Nunca sincronizado → imediato
 *
 * A elegibilidade é filtrada NO BANCO (não em JS): um filtro em memória sobre
 * um lote fixo deixava posts elegíveis de fora quando os primeiros N candidatos
 * eram inelegíveis. Contas com health_status='error' ou inativas são puladas.
 * Chamadas à Meta são diretas (sem proxy). Métrica não devolvida nunca apaga
 * valor já salvo (insightsUpdatePayload).
 */

import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { fetchPostInsights, insightsUpdatePayload, type InsightsMediaKind } from "@/lib/meta-insights";
import { requireCronAuth } from "@/lib/cron-auth";

export const runtime = "nodejs";
export const maxDuration = 120;

const PER_SOURCE_LIMIT = 200;
const BATCH_SIZE = 160;
const CONCURRENCY = 4;
const RUN_BUDGET_MS = 95_000;

const H = 60 * 60 * 1000;
const D = 24 * H;

type Table = "scheduled_posts" | "pending_containers";

interface Candidate {
  table: Table;
  id: string;
  media_id: string;
  kind: InsightsMediaKind;
  fetched_at: string | null;
  account_id: string;
  token: string;
}

interface AccountEmbed {
  id: string;
  meta_access_token: string | null;
  health_status: string;
  is_active: boolean;
}

const iso = (msAgo: number, now: number) => new Date(now - msAgo).toISOString();

/** Filtro `or` de elegibilidade de Reel pela idade (coluna de data varia por tabela). */
function reelEligibility(dateCol: string, now: number): string {
  return [
    "insights_fetched_at.is.null",
    `and(${dateCol}.gte.${iso(2 * D, now)},insights_fetched_at.lt.${iso(4 * H, now)})`,
    `and(${dateCol}.lt.${iso(2 * D, now)},${dateCol}.gte.${iso(14 * D, now)},insights_fetched_at.lt.${iso(D, now)})`,
    `and(${dateCol}.lt.${iso(14 * D, now)},${dateCol}.gte.${iso(60 * D, now)},insights_fetched_at.lt.${iso(7 * D, now)})`,
  ].join(",");
}

function toCandidate(table: Table, kind: InsightsMediaKind, row: Record<string, unknown>): Candidate | null {
  const acc = (Array.isArray(row.instagram_accounts) ? row.instagram_accounts[0] : row.instagram_accounts) as AccountEmbed | null;
  if (!acc?.meta_access_token || !row.media_id) return null;
  return {
    table,
    id: row.id as string,
    media_id: row.media_id as string,
    kind,
    fetched_at: (row.insights_fetched_at as string | null) ?? null,
    account_id: acc.id,
    token: acc.meta_access_token,
  };
}

export async function GET(request: NextRequest) {
  const cronAuth = requireCronAuth(request);
  if (!cronAuth.ok) return cronAuth.response;

  const admin = getSupabaseAdmin();
  const now = Date.now();
  const ACCOUNT = "instagram_accounts!inner(id, meta_access_token, health_status, is_active)";

  const base = (table: Table, extraCols: string) =>
    (admin as any)
      .from(table)
      .select(`id, media_id, insights_fetched_at, ${extraCols}${ACCOUNT}`)
      .eq("status", "published")
      .not("media_id", "is", null)
      .neq("media_id", "")
      .eq("instagram_accounts.is_active", true)
      .neq("instagram_accounts.health_status", "error")
      .order("insights_fetched_at", { ascending: true, nullsFirst: true })
      .limit(PER_SOURCE_LIMIT);

  const [reelsRes, storiesRes, loopRes] = await Promise.all([
    base("scheduled_posts", "published_at, ")
      .neq("post_type", "story")
      .or(reelEligibility("published_at", now)),
    base("scheduled_posts", "published_at, ")
      .eq("post_type", "story")
      .gte("published_at", iso(26 * H, now))
      .or(`insights_fetched_at.is.null,insights_fetched_at.lt.${iso(H, now)}`),
    base("pending_containers", "created_at, ")
      .or(reelEligibility("created_at", now)),
  ]);

  for (const [name, res] of [["reels", reelsRes], ["stories", storiesRes], ["loop", loopRes]] as const) {
    if (res.error) {
      console.error(`[cron/sync-post-insights] Erro ao buscar ${name}:`, res.error.message);
      return NextResponse.json({ error: `${name}: ${res.error.message}` }, { status: 500 });
    }
  }

  const candidates: Candidate[] = [
    ...(reelsRes.data ?? []).map((r: Record<string, unknown>) => toCandidate("scheduled_posts", "reel", r)),
    ...(storiesRes.data ?? []).map((r: Record<string, unknown>) => toCandidate("scheduled_posts", "story", r)),
    ...(loopRes.data ?? []).map((r: Record<string, unknown>) => toCandidate("pending_containers", "reel", r)),
  ].filter((c): c is Candidate => c !== null);

  // Nunca sincronizados primeiro, depois os mais antigos.
  candidates.sort((a, b) => {
    if (!a.fetched_at && !b.fetched_at) return 0;
    if (!a.fetched_at) return -1;
    if (!b.fetched_at) return 1;
    return a.fetched_at.localeCompare(b.fetched_at);
  });
  const batch = candidates.slice(0, BATCH_SIZE);

  if (batch.length === 0) {
    return NextResponse.json({ synced: 0, message: "Nenhum post pendente de sincronização." });
  }

  const startedAt = Date.now();
  const rateLimitedAccounts = new Set<string>();
  let synced = 0;
  let withViews = 0;
  let failed = 0;
  let skippedRateLimit = 0;
  let cursor = 0;

  async function worker() {
    while (cursor < batch.length) {
      if (Date.now() - startedAt > RUN_BUDGET_MS) return;
      const post = batch[cursor++];
      if (rateLimitedAccounts.has(post.account_id)) { skippedRateLimit++; continue; }

      try {
        const metrics = await fetchPostInsights(post.media_id, post.token, post.kind);
        if (metrics.rateLimited) {
          // Não avança insights_fetched_at: o post volta no próximo run.
          rateLimitedAccounts.add(post.account_id);
          skippedRateLimit++;
          continue;
        }
        const { error } = await (admin as any)
          .from(post.table)
          .update(insightsUpdatePayload(metrics))
          .eq("id", post.id);
        if (error) throw new Error(error.message);
        synced++;
        if (metrics.plays !== null) withViews++;
        else failed++;
      } catch (err) {
        failed++;
        console.warn(
          `[cron/sync-post-insights] Falha em ${post.table}/${post.id}:`,
          err instanceof Error ? err.message : String(err)
        );
      }
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  const summary = {
    synced,
    with_views: withViews,
    failed,
    skipped_rate_limit: skippedRateLimit,
    rate_limited_accounts: rateLimitedAccounts.size,
    batch: batch.length,
    candidates: candidates.length,
    by_source: {
      reels: reelsRes.data?.length ?? 0,
      stories: storiesRes.data?.length ?? 0,
      loop: loopRes.data?.length ?? 0,
    },
  };
  console.log("[cron/sync-post-insights] ✓", summary);
  return NextResponse.json(summary);
}
