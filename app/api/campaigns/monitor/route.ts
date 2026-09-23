import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getSupabaseAdmin } from "@/lib/supabase";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
    return NextResponse.json({
      metrics: { total_published: 0, total_pending: 0, total_failed: 0, total_overdue: 0, total_likes: 0, active_campaigns: 0, next_publish_in_ms: null },
      accounts: [],
      timeline: { published: [], upcoming: [] },
      last_updated: new Date().toISOString(),
    });
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  const admin = getSupabaseAdmin() as any;
  const now = new Date();
  const nowIso = now.toISOString();
  const since24h = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
  const since6h  = new Date(now.getTime() -  6 * 60 * 60 * 1000).toISOString();
  const next3h   = new Date(now.getTime() +  3 * 60 * 60 * 1000).toISOString();

  const [accountsRes, postsRes] = await Promise.all([
    admin
      .from("instagram_accounts")
      .select("id, username, display_name, avatar_url, health_status")
      .eq("user_id", user.id)
      .eq("is_active", true),

    admin
      .from("scheduled_posts")
      .select("id, account_id, campaign_id, status, scheduled_at, published_at, media_id, insights_likes, insights_plays, insights_reach, insights_comments, insights_fetched_at, error_message")
      .eq("user_id", user.id)
      .not("campaign_id", "is", null)
      // pending/publishing (any date), failed (recent), published (last 24h)
      .or(`status.in.(pending,publishing,failed),published_at.gte.${since24h},scheduled_at.gte.${since24h}`)
      .order("scheduled_at", { ascending: true }),
  ]);

  const accounts = (accountsRes.data ?? []) as {
    id: string; username: string; display_name: string | null;
    avatar_url: string | null; health_status: string;
  }[];

  const posts = (postsRes.data ?? []) as {
    id: string; account_id: string; campaign_id: string; status: string;
    scheduled_at: string; published_at: string | null; media_id: string | null;
    insights_likes: number | null; insights_plays: number | null;
    insights_reach: number | null; insights_comments: number | null;
    insights_fetched_at: string | null; error_message: string | null;
  }[];

  const accountMap = new Map(accounts.map(a => [a.id, a]));
  const campaignIds = new Set(posts.map(p => p.campaign_id));

  const accountStatsMap = new Map<string, {
    account_id: string; username: string; display_name: string | null;
    avatar_url: string | null;
    total: number; published: number; pending: number; failed: number;
    overdue_count: number;
    last_published_at: string | null; next_scheduled_at: string | null;
    total_likes: number; total_plays: number; total_reach: number; total_comments: number;
    synced_posts: number;
    campaign_ids: string[];
    last_error_message: string | null;
  }>();

  for (const post of posts) {
    const acc = accountMap.get(post.account_id);
    if (!acc) continue;

    if (!accountStatsMap.has(post.account_id)) {
      accountStatsMap.set(post.account_id, {
        account_id: post.account_id,
        username: acc.username,
        display_name: acc.display_name,
        avatar_url: acc.avatar_url,
        total: 0, published: 0, pending: 0, failed: 0, overdue_count: 0,
        last_published_at: null, next_scheduled_at: null,
        total_likes: 0, total_plays: 0, total_reach: 0, total_comments: 0,
        synced_posts: 0,
        campaign_ids: [],
        last_error_message: null,
      });
    }

    const s = accountStatsMap.get(post.account_id)!;
    s.total++;

    if (post.status === "published") {
      s.published++;
      s.total_likes    += post.insights_likes    ?? 0;
      s.total_plays    += post.insights_plays    ?? 0;
      s.total_reach    += post.insights_reach    ?? 0;
      s.total_comments += post.insights_comments ?? 0;
      if (post.insights_fetched_at) s.synced_posts++;
      const pat = post.published_at ?? post.scheduled_at;
      if (!s.last_published_at || pat > s.last_published_at) s.last_published_at = pat;
    } else if (post.status === "pending" || post.status === "publishing") {
      s.pending++;
      // Overdue = past scheduled time but not yet published
      if (post.scheduled_at < nowIso) s.overdue_count++;
      if (!s.next_scheduled_at || post.scheduled_at < s.next_scheduled_at)
        s.next_scheduled_at = post.scheduled_at;
    } else if (post.status === "failed") {
      s.failed++;
      // Keep the most recent error message (posts ordered by scheduled_at asc, so last wins = latest)
      if (post.error_message) s.last_error_message = post.error_message;
    } else if (post.status === "cancelled") {
      s.failed++;
    }

    if (!s.campaign_ids.includes(post.campaign_id)) s.campaign_ids.push(post.campaign_id);
  }

  const accountList = Array.from(accountStatsMap.values())
    .sort((a, b) => {
      // Overdue first, then pending, then completed, then by recency
      if (a.overdue_count > 0 && b.overdue_count === 0) return -1;
      if (a.overdue_count === 0 && b.overdue_count > 0) return 1;
      if (a.pending > 0 && b.pending === 0) return -1;
      if (a.pending === 0 && b.pending > 0) return 1;
      if (a.last_published_at && b.last_published_at)
        return new Date(b.last_published_at).getTime() - new Date(a.last_published_at).getTime();
      if (a.last_published_at) return -1;
      if (b.last_published_at) return 1;
      return 0;
    });

  const totalPublished  = accountList.reduce((s, a) => s + a.published, 0);
  const totalPending    = accountList.reduce((s, a) => s + a.pending, 0);
  const totalFailed     = accountList.reduce((s, a) => s + a.failed, 0);
  const totalOverdue    = accountList.reduce((s, a) => s + a.overdue_count, 0);
  const totalLikes      = accountList.reduce((s, a) => s + a.total_likes, 0);
  const totalPlays      = accountList.reduce((s, a) => s + a.total_plays, 0);
  const totalReach      = accountList.reduce((s, a) => s + a.total_reach, 0);
  const totalComments   = accountList.reduce((s, a) => s + a.total_comments, 0);
  const activeCampaigns = campaignIds.size;

  const publishedTimeline = posts
    .filter(p => p.status === "published" && p.published_at && p.published_at >= since6h)
    .map(p => ({
      account_username: accountMap.get(p.account_id)?.username ?? "?",
      at: p.published_at!,
      media_id: p.media_id,
    }))
    .sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());

  const upcomingTimeline = posts
    .filter(p => (p.status === "pending" || p.status === "publishing") && p.scheduled_at <= next3h)
    .map(p => ({
      account_username: accountMap.get(p.account_id)?.username ?? "?",
      at: p.scheduled_at,
    }))
    .sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());

  const earliestNext = accountList
    .filter(a => a.next_scheduled_at)
    .map(a => new Date(a.next_scheduled_at!).getTime())
    .sort((a, b) => a - b)[0] ?? null;

  const next_publish_in_ms = earliestNext !== null
    ? Math.max(0, earliestNext - now.getTime())
    : null;

  return NextResponse.json({
    metrics: {
      total_published: totalPublished,
      total_pending: totalPending,
      total_failed: totalFailed,
      total_overdue: totalOverdue,
      total_likes: totalLikes,
      total_plays: totalPlays,
      total_reach: totalReach,
      total_comments: totalComments,
      active_campaigns: activeCampaigns,
      next_publish_in_ms,
    },
    accounts: accountList,
    timeline: { published: publishedTimeline, upcoming: upcomingTimeline },
    last_updated: now.toISOString(),
  });
}
