/**
 * /api/cron/sync-post-insights
 *
 * Sincroniza métricas (likes/comments/reach/views/shares/saved) dos posts
 * publicados em background, alimentando o total de views real da Dashboard.
 * Antes, insights_plays só era preenchido quando o usuário clicava "Atualizar"
 * manualmente em um post na tela de Analytics — a maioria dos posts nunca
 * tinha sido sincronizada.
 *
 * Prioridade de fila (mais valioso primeiro):
 *   1. Nunca sincronizado (insights_fetched_at IS NULL)
 *   2. Post recente (<30d) sincronizado há mais de 24h — ainda ganhando views
 *   3. Post antigo sincronizado há mais de 7 dias — refresh raro (views já estabilizaram)
 *
 * Contas com health_status='error' são puladas. As chamadas de insights são
 * server-to-server diretas com a Meta (sem proxy).
 */

import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { fetchPostInsights } from "@/lib/meta-insights";

export const runtime = "nodejs";
export const maxDuration = 120;

const CANDIDATE_LIMIT = 500;
const BATCH_SIZE = 40;
const DELAY_MS = 400;
const RUN_BUDGET_MS = 90_000;

const RECENT_POST_MS = 30 * 24 * 60 * 60 * 1000; // 30 dias
const RECENT_REFRESH_MS = 24 * 60 * 60 * 1000;   // 24h
const OLD_REFRESH_MS = 7 * 24 * 60 * 60 * 1000;  // 7 dias

interface PostRow {
  id: string;
  media_id: string;
  published_at: string | null;
  insights_fetched_at: string | null;
  instagram_accounts: {
    id: string;
    meta_access_token: string | null;
    health_status: string;
  } | null;
}

function isEligible(p: PostRow, nowMs: number): boolean {
  if (!p.instagram_accounts || p.instagram_accounts.health_status === "error") return false;
  if (!p.instagram_accounts.meta_access_token) return false;

  if (!p.insights_fetched_at) return true;

  const fetchedAgo = nowMs - new Date(p.insights_fetched_at).getTime();
  const publishedAgo = p.published_at ? nowMs - new Date(p.published_at).getTime() : Infinity;

  if (publishedAgo < RECENT_POST_MS) return fetchedAgo > RECENT_REFRESH_MS;
  return fetchedAgo > OLD_REFRESH_MS;
}

export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  const auth = request.headers.get("authorization");
  if (!cronSecret) {
    console.warn("[cron/sync-post-insights] CRON_SECRET não definido — requisição aceita sem auth.");
  } else if (auth !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = getSupabaseAdmin();

  const { data: rows, error } = await admin
    .from("scheduled_posts")
    .select(
      "id, media_id, published_at, insights_fetched_at, " +
      "instagram_accounts(id, meta_access_token, health_status)"
    )
    .eq("status", "published")
    .not("media_id", "is", null)
    .order("insights_fetched_at", { ascending: true, nullsFirst: true })
    .limit(CANDIDATE_LIMIT);

  if (error) {
    console.error("[cron/sync-post-insights] Erro ao buscar posts:", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const nowMs = Date.now();
  const candidates = ((rows ?? []) as unknown as PostRow[]).map((r) => ({
    ...r,
    instagram_accounts: Array.isArray(r.instagram_accounts) ? r.instagram_accounts[0] ?? null : r.instagram_accounts,
  }));
  const eligible = candidates.filter((p) => isEligible(p, nowMs)).slice(0, BATCH_SIZE);

  if (eligible.length === 0) {
    return NextResponse.json({ synced: 0, message: "Nenhum post pendente de sincronização." });
  }

  const startedAt = Date.now();
  let synced = 0;
  let skipped = 0;

  for (const [i, post] of eligible.entries()) {
    if (Date.now() - startedAt > RUN_BUDGET_MS) break;
    if (i > 0) await new Promise((r) => setTimeout(r, DELAY_MS));

    const account = post.instagram_accounts!;

    try {
      const metrics = await fetchPostInsights(post.media_id, account.meta_access_token!);
      await admin
        .from("scheduled_posts")
        .update({
          insights_likes: metrics.likes,
          insights_comments: metrics.comments,
          insights_reach: metrics.reach,
          insights_plays: metrics.plays,
          insights_shares: metrics.shares,
          insights_saved: metrics.saved,
          insights_fetched_at: new Date().toISOString(),
        } as unknown as Record<string, unknown>)
        .eq("id", post.id);
      synced++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[cron/sync-post-insights] Falha no post ${post.id}:`, msg);
      skipped++;
    }
  }

  console.log(`[cron/sync-post-insights] ✓ synced=${synced} skipped=${skipped} eligible=${eligible.length}`);
  return NextResponse.json({ synced, skipped, eligible: eligible.length, candidates: candidates.length });
}
