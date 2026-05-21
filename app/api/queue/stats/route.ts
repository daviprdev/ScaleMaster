import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getSupabaseAdmin } from "@/lib/supabase";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface AccountRow {
  id: string;
  username: string;
  display_name: string | null;
  is_active: boolean;
}

interface ScheduledPostRow {
  id: string;
  account_id: string;
  status: string;
  published_at: string | null;
  media_id: string | null;
}

interface SinglePostAccountRow {
  post_id: string;
  account_id: string;
  status: string;
  published_at: string | null;
  media_id: string | null;
}

interface LoopRow {
  id: string;
  status: string;
  loop_accounts: { account_id: string }[];
}

export async function GET() {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
    return NextResponse.json({
      metrics: { total_1h: 0, posted_1h: 0, pending: 0, processing: 0, errors_24h: 0 },
      recent_posts: [],
      idle_accounts: [],
      per_account: [],
      last_updated: new Date().toISOString(),
    });
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  const admin = getSupabaseAdmin() as any;
  const now = new Date();
  const since1h = new Date(now.getTime() - 60 * 60 * 1000).toISOString();
  const since24h = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();

  // Parallel fetch: accounts + scheduled posts + single post IDs + active loops
  const [accountsRes, scheduledRes, singlePostsIdRes, loopsRes] = await Promise.all([
    admin
      .from("instagram_accounts")
      .select("id, username, display_name, is_active")
      .eq("user_id", user.id),

    admin
      .from("scheduled_posts")
      .select("id, account_id, status, published_at, media_id")
      .eq("user_id", user.id)
      .or(`status.eq.pending,status.eq.publishing,published_at.gte.${since24h}`),

    admin
      .from("single_posts")
      .select("id")
      .eq("user_id", user.id),

    admin
      .from("loops")
      .select("id, status, loop_accounts(account_id)")
      .eq("user_id", user.id)
      .eq("status", "active"),
  ]);

  const accounts = (accountsRes.data ?? []) as AccountRow[];
  const scheduledPosts = (scheduledRes.data ?? []) as ScheduledPostRow[];
  const singlePostIds = ((singlePostsIdRes.data ?? []) as { id: string }[]).map(p => p.id);
  const activeLoops = (loopsRes.data ?? []) as LoopRow[];

  // Fetch single post accounts if any exist
  let singlePostAccounts: SinglePostAccountRow[] = [];
  if (singlePostIds.length > 0) {
    const { data } = await admin
      .from("single_post_accounts")
      .select("post_id, account_id, status, published_at, media_id")
      .in("post_id", singlePostIds)
      .or(`status.eq.pending,status.eq.publishing,published_at.gte.${since24h}`);
    singlePostAccounts = data ?? [];
  }

  // Build lookup structures
  const accountMap = new Map(accounts.map(a => [a.id, a]));
  const loopAccountIds = new Set(
    activeLoops.flatMap(l => l.loop_accounts.map(la => la.account_id))
  );

  // Unified post entries for metric computation
  const allPosts = [
    ...scheduledPosts.map(p => ({
      id: p.id,
      account_id: p.account_id,
      status: p.status,
      published_at: p.published_at,
      media_id: p.media_id,
      source: "scheduled" as const,
    })),
    ...singlePostAccounts.map(p => ({
      id: `spa_${p.post_id}_${p.account_id}`,
      account_id: p.account_id,
      status: p.status,
      published_at: p.published_at,
      media_id: p.media_id,
      source: "single" as const,
    })),
  ];

  const ts1h = now.getTime() - 60 * 60 * 1000;
  const ts24h = now.getTime() - 24 * 60 * 60 * 1000;

  const isRecent = (dateStr: string | null, since: number) =>
    dateStr != null && new Date(dateStr).getTime() >= since;

  const posted_1h = allPosts.filter(p => p.status === "published" && isRecent(p.published_at, ts1h)).length;
  const errors_1h = allPosts.filter(p => p.status === "failed" && isRecent(p.published_at, ts1h)).length;
  const total_1h = posted_1h + errors_1h;
  const pending = allPosts.filter(p => p.status === "pending").length;
  const processing = allPosts.filter(p => p.status === "publishing").length;
  const errors_24h = allPosts.filter(p => p.status === "failed" && isRecent(p.published_at, ts24h)).length;

  // Recent posts: published in last 1h, newest first, max 25
  const recent_posts = allPosts
    .filter(p => p.status === "published" && isRecent(p.published_at, ts1h))
    .sort((a, b) => new Date(b.published_at!).getTime() - new Date(a.published_at!).getTime())
    .slice(0, 25)
    .map(p => {
      const acc = accountMap.get(p.account_id);
      return {
        id: p.id,
        account_id: p.account_id,
        account_username: acc?.username ?? "desconhecido",
        account_display_name: acc?.display_name ?? null,
        media_id: p.media_id,
        published_at: p.published_at!,
        source: p.source,
      };
    });

  // Per-account stats aggregation
  const perAccountMap = new Map<string, { pending: number; posted_24h: number; errors_24h: number }>();
  for (const p of allPosts) {
    if (!perAccountMap.has(p.account_id)) {
      perAccountMap.set(p.account_id, { pending: 0, posted_24h: 0, errors_24h: 0 });
    }
    const stats = perAccountMap.get(p.account_id)!;
    if (p.status === "pending" || p.status === "publishing") {
      stats.pending++;
    } else if (p.status === "published" && isRecent(p.published_at, ts24h)) {
      stats.posted_24h++;
    } else if (p.status === "failed" && isRecent(p.published_at, ts24h)) {
      stats.errors_24h++;
    }
  }

  const per_account = accounts
    .filter(a => perAccountMap.has(a.id) || loopAccountIds.has(a.id))
    .map(a => ({
      id: a.id,
      username: a.username,
      display_name: a.display_name,
      ...(perAccountMap.get(a.id) ?? { pending: 0, posted_24h: 0, errors_24h: 0 }),
      has_active_loop: loopAccountIds.has(a.id),
    }));

  // Idle: active accounts with zero presence in per_account
  const activeAccountIds = new Set(per_account.map(a => a.id));
  const idle_accounts = accounts
    .filter(a => a.is_active && !activeAccountIds.has(a.id))
    .map(a => ({ id: a.id, username: a.username, display_name: a.display_name }));

  return NextResponse.json({
    metrics: { total_1h, posted_1h, pending, processing, errors_24h },
    recent_posts,
    idle_accounts,
    per_account,
    last_updated: now.toISOString(),
  });
}
