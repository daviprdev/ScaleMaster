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
 * Cadência por idade (as views crescem rápido no começo e estabilizam depois),
 * em lib/insights-cadence.ts:
 *   Reel  nunca lido  → 1ª leitura com 15 min+ (aos ~2 min vinha ≈0 views)
 *   Reel  < 2h        → a cada 30 min
 *   Reel  2–6h        → a cada 1h
 *   Reel  6h–2 dias   → a cada 4h
 *   Reel  2–14 dias   → a cada 24h
 *   Reel  14–60 dias  → a cada 7 dias
 *   Reel  > 60 dias   → não atualiza mais
 *   Story < 26h       → a cada 1h (a Meta só expõe insights de story ativo);
 *                       nunca lido → imediato
 * Idade do Loop: published_at, com created_at nas linhas antigas sem ele.
 *
 * A elegibilidade é filtrada NO BANCO (não em JS): um filtro em memória sobre
 * um lote fixo deixava posts elegíveis de fora quando os primeiros N candidatos
 * eram inelegíveis. Cada origem de reel faz duas consultas (jovens < 2 dias e
 * antigos), para as faixas diária/semanal não tomarem o limite das releituras
 * novas; o lote junta tudo por prioridade (stories → nunca lidos → jovens →
 * antigos, o mais atrasado primeiro). `leftover` no resumo mostra o que ficou
 * para o próximo run. Contas com health_status='error' ou inativas são puladas.
 * Chamadas à Meta são diretas (sem proxy). Métrica não devolvida nunca apaga
 * valor já salvo (insightsUpdatePayload).
 */

import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { fetchPostInsights, insightsUpdatePayload, type InsightsMediaKind } from "@/lib/meta-insights";
import { requireCronAuth } from "@/lib/cron-auth";
import {
  LOOP_DATE,
  POSTAR_DATE,
  STORY_EVERY,
  STORY_MAX_AGE,
  classifyReel,
  classifyStory,
  planBatch,
  reelAgeDate,
  reelEligibilityFilter,
  type AgeGroup,
  type DateSource,
  type Prioritized,
} from "@/lib/insights-cadence";

export const runtime = "nodejs";
export const maxDuration = 120;

const STORY_LIMIT = 200;
const YOUNG_LIMIT = 500;
const OLD_LIMIT = 200;
const BATCH_SIZE = 500;
// ~8 posts/s com 4 em paralelo (medido); 6 cabem folgados no orçamento.
const CONCURRENCY = 6;
const RUN_BUDGET_MS = 95_000;

type Table = "scheduled_posts" | "pending_containers";

interface Candidate extends Prioritized {
  table: Table;
  id: string;
  media_id: string;
  kind: InsightsMediaKind;
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

/** `dates` nulo = story. Linha que não está devida pela cadência (ou sem token) sai. */
function toCandidate(
  table: Table,
  kind: InsightsMediaKind,
  row: Record<string, unknown>,
  dates: DateSource | null,
  now: number
): Candidate | null {
  const acc = (Array.isArray(row.instagram_accounts) ? row.instagram_accounts[0] : row.instagram_accounts) as AccountEmbed | null;
  if (!acc?.meta_access_token || !row.media_id) return null;
  const fetchedAt = (row.insights_fetched_at as string | null) ?? null;
  const due = dates ? classifyReel(reelAgeDate(row, dates), fetchedAt, now) : classifyStory(fetchedAt, now);
  if (!due) return null;
  return {
    ...due,
    key: `${table}:${row.id as string}`,
    table,
    id: row.id as string,
    media_id: row.media_id as string,
    kind,
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

  const base = (table: Table, extraCols: string, limit: number) =>
    (admin as any)
      .from(table)
      .select(`id, media_id, insights_fetched_at, ${extraCols}${ACCOUNT}`)
      .eq("status", "published")
      .not("media_id", "is", null)
      .neq("media_id", "")
      .eq("instagram_accounts.is_active", true)
      .neq("instagram_accounts.health_status", "error")
      .order("insights_fetched_at", { ascending: true, nullsFirst: true })
      .limit(limit);

  const postar = (group: AgeGroup) =>
    base("scheduled_posts", "published_at, ", group === "young" ? YOUNG_LIMIT : OLD_LIMIT)
      .neq("post_type", "story")
      .or(reelEligibilityFilter(group, POSTAR_DATE, now));
  const loop = (group: AgeGroup) =>
    base("pending_containers", "published_at, created_at, ", group === "young" ? YOUNG_LIMIT : OLD_LIMIT)
      .or(reelEligibilityFilter(group, LOOP_DATE, now));

  const [reelsRes, reelsOldRes, storiesRes, loopRes, loopOldRes] = await Promise.all([
    postar("young"),
    postar("old"),
    base("scheduled_posts", "published_at, ", STORY_LIMIT)
      .eq("post_type", "story")
      .gte("published_at", iso(STORY_MAX_AGE, now))
      .or(`insights_fetched_at.is.null,insights_fetched_at.lt.${iso(STORY_EVERY, now)}`),
    loop("young"),
    loop("old"),
  ]);

  const results = [
    ["reels", reelsRes], ["reels_old", reelsOldRes], ["stories", storiesRes],
    ["loop", loopRes], ["loop_old", loopOldRes],
  ] as const;
  for (const [name, res] of results) {
    if (res.error) {
      console.error(`[cron/sync-post-insights] Erro ao buscar ${name}:`, res.error.message);
      return NextResponse.json({ error: `${name}: ${res.error.message}` }, { status: 500 });
    }
  }

  const rows = (res: { data: Record<string, unknown>[] | null }) => res.data ?? [];
  const all: Candidate[] = [
    ...[...rows(reelsRes), ...rows(reelsOldRes)].map((r) => toCandidate("scheduled_posts", "reel", r, POSTAR_DATE, now)),
    ...rows(storiesRes).map((r) => toCandidate("scheduled_posts", "story", r, null, now)),
    ...[...rows(loopRes), ...rows(loopOldRes)].map((r) => toCandidate("pending_containers", "reel", r, LOOP_DATE, now)),
  ].filter((c): c is Candidate => c !== null);

  // Stories → nunca lidos → faixas jovens → faixas antigas; o mais atrasado primeiro.
  const { batch, leftover, candidates, byTier } = planBatch(all, BATCH_SIZE);

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
    candidates,
    leftover,
    by_source: {
      reels: rows(reelsRes).length + rows(reelsOldRes).length,
      stories: rows(storiesRes).length,
      loop: rows(loopRes).length + rows(loopOldRes).length,
    },
    by_tier: byTier,
  };
  console.log("[cron/sync-post-insights] ✓", summary);
  return NextResponse.json(summary);
}
