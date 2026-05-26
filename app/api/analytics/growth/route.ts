import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getSupabaseAdmin } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });

  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
    return NextResponse.json({
      accounts: [], folders: [], chart_data: [],
      kpi: { followers_now: 0, followers_30d_ago: 0, followers_growth: 0, followers_growth_pct: 0, posts_30d: 0, reach_30d: 0, days_with_data: 0 },
      top_videos: [], selected_account_id: null, selected_folder_id: null, days: 30,
    });
  }

  const url = new URL(req.url);
  const accountId = url.searchParams.get("account_id") ?? null;
  const folderId = url.searchParams.get("folder_id") ?? null;
  const days = Math.min(90, Math.max(7, parseInt(url.searchParams.get("days") ?? "30")));

  const admin = getSupabaseAdmin() as any;
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  // ── Fetch accounts for the selector + filtering ───────────────────────────
  let accountsQuery = admin
    .from("instagram_accounts")
    .select("id, username, display_name, avatar_url, followers_count, folder_id, is_active")
    .eq("user_id", user.id)
    .eq("is_active", true)
    .order("username");

  if (folderId) accountsQuery = accountsQuery.eq("folder_id", folderId);
  if (accountId) accountsQuery = accountsQuery.eq("id", accountId);

  const [accountsRes, foldersRes] = await Promise.all([
    accountsQuery,
    admin.from("account_folders").select("id, name").eq("user_id", user.id).order("name"),
  ]);

  const accounts = (accountsRes.data ?? []) as {
    id: string; username: string; display_name: string | null;
    avatar_url: string | null; followers_count: number | null; folder_id: string | null;
  }[];
  const folders = (foldersRes.data ?? []) as { id: string; name: string }[];
  const accountIds = accounts.map((a) => a.id);

  // ── History: aggregate per date across selected accounts ──────────────────
  let historyRows: { account_id: string; date: string; followers_count: number; automated_posts_count: number }[] = [];
  if (accountIds.length > 0) {
    const { data } = await admin
      .from("account_analytics_history")
      .select("account_id, date, followers_count, automated_posts_count")
      .in("account_id", accountIds)
      .gte("date", since)
      .order("date", { ascending: true });
    historyRows = data ?? [];
  }

  // Aggregate by date — sum followers for all selected accounts per day
  const dateMap = new Map<string, { followers: number; posts: number }>();
  for (const row of historyRows) {
    const existing = dateMap.get(row.date) ?? { followers: 0, posts: 0 };
    dateMap.set(row.date, {
      followers: existing.followers + (row.followers_count ?? 0),
      posts: existing.posts + (row.automated_posts_count ?? 0),
    });
  }
  const chart_data = Array.from(dateMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, v]) => ({
      date,
      label: new Date(date + "T12:00:00").toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" }),
      followers: v.followers,
      posts: v.posts,
    }));

  // ── KPI ───────────────────────────────────────────────────────────────────
  const followersNow = accounts.reduce((s, a) => s + (a.followers_count ?? 0), 0);
  const followers30dAgo = chart_data.length > 0 ? chart_data[0].followers : followersNow;
  const followersGrowth = followersNow - followers30dAgo;
  const followersGrowthPct =
    followers30dAgo > 0 ? Math.round((followersGrowth / followers30dAgo) * 1000) / 10 : 0;

  let postsRows: { insights_reach: number | null }[] = [];
  if (accountIds.length > 0) {
    const sinceTs = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
    const { data } = await admin
      .from("scheduled_posts")
      .select("insights_reach")
      .in("account_id", accountIds)
      .eq("status", "published")
      .gte("published_at", sinceTs);
    postsRows = data ?? [];
  }
  const posts30d = postsRows.length;
  const reach30d = postsRows.reduce((s, p) => s + (p.insights_reach ?? 0), 0);

  // ── Top 3 Videos ──────────────────────────────────────────────────────────
  let topVideos: unknown[] = [];
  if (accountIds.length > 0) {
    const { data } = await admin
      .from("scheduled_posts")
      .select(
        "id, caption, video_url, insights_plays, insights_reach, insights_likes, published_at, " +
        "instagram_accounts(username)"
      )
      .in("account_id", accountIds)
      .eq("user_id", user.id)
      .eq("status", "published")
      .not("insights_plays", "is", null)
      .order("insights_plays", { ascending: false })
      .limit(3);

    topVideos = (data ?? []).map((v: any) => ({
      id: v.id,
      caption: v.caption as string | null,
      video_url: v.video_url as string | null,
      plays: v.insights_plays as number,
      reach: v.insights_reach as number | null,
      likes: v.insights_likes as number | null,
      published_at: v.published_at as string | null,
      account_username: (
        Array.isArray(v.instagram_accounts)
          ? v.instagram_accounts[0]?.username
          : (v.instagram_accounts as { username?: string } | null)?.username
      ) as string | undefined,
    }));
  }

  return NextResponse.json({
    accounts,
    folders,
    chart_data,
    kpi: {
      followers_now: followersNow,
      followers_30d_ago: followers30dAgo,
      followers_growth: followersGrowth,
      followers_growth_pct: followersGrowthPct,
      posts_30d: posts30d,
      reach_30d: reach30d,
      days_with_data: chart_data.length,
    },
    top_videos: topVideos,
    selected_account_id: accountId,
    selected_folder_id: folderId,
    days,
  });
}
