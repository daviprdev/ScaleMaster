import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getSupabaseAdmin } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/published
 *
 * Retorna todas as publicações concluídas (status='published') do usuário,
 * unificando duas fontes:
 *   - scheduled_posts  → Postar manual, Clonar, Stories
 *   - pending_containers → Loop
 *
 * Query params opcionais:
 *   account_id  — filtra por conta específica
 *   limit       — máximo de registros (default 500, max 2000)
 *   offset      — paginação (default 0)
 */
export async function GET(request: NextRequest) {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
    return NextResponse.json({ items: [], total: 0, accounts: [] });
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });

  const admin = getSupabaseAdmin() as any;
  const { searchParams } = new URL(request.url);
  const accountId = searchParams.get("account_id") || null;
  const limit = Math.min(2000, Math.max(1, Number(searchParams.get("limit")) || 500));
  const offset = Math.max(0, Number(searchParams.get("offset")) || 0);

  // ── 1. Buscar contas ativas do usuário ──────────────────────────────
  const { data: accountsData } = await admin
    .from("instagram_accounts")
    .select("id, username, display_name, avatar_url, is_active, followers_count")
    .eq("user_id", user.id)
    .eq("is_active", true)
    .order("username", { ascending: true });

  const accounts = (accountsData ?? []).map((a: any) => ({
    id: a.id,
    username: a.username,
    display_name: a.display_name,
    avatar_url: a.avatar_url,
    followers_count: a.followers_count,
  }));

  // ── 2. Buscar scheduled_posts publicados ────────────────────────────
  let spQuery = admin
    .from("scheduled_posts")
    .select(
      `id, account_id, video_url, caption, status, media_id, post_type,
       published_at, created_at, scheduled_at,
       insights_plays, insights_reach, insights_likes, insights_comments, insights_shares, insights_saved,
       campaign_id,
       instagram_accounts(username, display_name, avatar_url)`,
      { count: "exact" }
    )
    .eq("user_id", user.id)
    .eq("status", "published");

  if (accountId) spQuery = spQuery.eq("account_id", accountId);

  const { data: spData, count: spCount } = await spQuery
    .order("published_at", { ascending: false })
    .range(offset, offset + limit - 1);

  // ── 3. Buscar pending_containers publicados (Loop) ──────────────────
  let pcQuery = admin
    .from("pending_containers")
    .select(
      `id, account_id, video_url, caption, status, media_id,
       created_at,
       insights_plays, insights_reach, insights_likes, insights_comments, insights_shares, insights_saved,
       loop_id,
       instagram_accounts(username, display_name, avatar_url)`,
      { count: "exact" }
    )
    .eq("user_id", user.id)
    .eq("status", "published");

  if (accountId) pcQuery = pcQuery.eq("account_id", accountId);

  const { data: pcData, count: pcCount } = await pcQuery
    .order("created_at", { ascending: false })
    .range(0, limit - 1);

  // ── 4. Unificar e normalizar ────────────────────────────────────────
  type PublishedItem = {
    id: string;
    source: "scheduled" | "loop";
    account_id: string | null;
    username: string | null;
    display_name: string | null;
    avatar_url: string | null;
    type: "story" | "reel";
    views: number | null;
    reach: number | null;
    likes: number | null;
    comments: number | null;
    shares: number | null;
    saved: number | null;
    caption: string | null;
    media_id: string | null;
    video_url: string | null;
    published_at: string;
    campaign_id: string | null;
    loop_id: string | null;
  };

  const items: PublishedItem[] = [];

  for (const row of (spData ?? []) as any[]) {
    const acc = Array.isArray(row.instagram_accounts)
      ? row.instagram_accounts[0]
      : row.instagram_accounts;
    items.push({
      id: row.id,
      source: "scheduled",
      account_id: row.account_id,
      username: acc?.username ?? null,
      display_name: acc?.display_name ?? null,
      avatar_url: acc?.avatar_url ?? null,
      type: row.post_type === "story" ? "story" : "reel",
      views: row.insights_plays ?? null,
      reach: row.insights_reach ?? null,
      likes: row.insights_likes ?? null,
      comments: row.insights_comments ?? null,
      shares: row.insights_shares ?? null,
      saved: row.insights_saved ?? null,
      caption: row.caption ?? null,
      media_id: row.media_id ?? null,
      video_url: row.video_url ?? null,
      published_at: row.published_at ?? row.created_at,
      campaign_id: row.campaign_id ?? null,
      loop_id: null,
    });
  }

  for (const row of (pcData ?? []) as any[]) {
    const acc = Array.isArray(row.instagram_accounts)
      ? row.instagram_accounts[0]
      : row.instagram_accounts;
    items.push({
      id: row.id,
      source: "loop",
      account_id: row.account_id,
      username: acc?.username ?? null,
      display_name: acc?.display_name ?? null,
      avatar_url: acc?.avatar_url ?? null,
      type: "reel",
      views: row.insights_plays ?? null,
      reach: row.insights_reach ?? null,
      likes: row.insights_likes ?? null,
      comments: row.insights_comments ?? null,
      shares: row.insights_shares ?? null,
      saved: row.insights_saved ?? null,
      caption: row.caption ?? null,
      media_id: row.media_id ?? null,
      video_url: row.video_url ?? null,
      published_at: row.created_at,
      campaign_id: null,
      loop_id: row.loop_id ?? null,
    });
  }

  // Ordenar por data descendente
  items.sort((a, b) => {
    const da = a.published_at ? new Date(a.published_at).getTime() : 0;
    const db = b.published_at ? new Date(b.published_at).getTime() : 0;
    return db - da;
  });

  // Cortar ao limite
  const trimmed = items.slice(0, limit);
  const total = (spCount ?? 0) + (pcCount ?? 0);

  // ── 5. Stats resumidos ──────────────────────────────────────────────
  const totalViews = items.reduce((sum, i) => sum + (i.views ?? 0), 0);
  const totalReach = items.reduce((sum, i) => sum + (i.reach ?? 0), 0);
  const storyCount = items.filter(i => i.type === "story").length;
  const reelCount = items.filter(i => i.type === "reel").length;

  return NextResponse.json({
    items: trimmed,
    total,
    accounts,
    stats: {
      total_views: totalViews,
      total_reach: totalReach,
      stories: storyCount,
      reels: reelCount,
    },
  });
}