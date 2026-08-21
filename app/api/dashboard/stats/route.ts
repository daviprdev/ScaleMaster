import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getSupabaseAdmin } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const GRADIENTS = [
  "from-violet-500 to-purple-600",
  "from-cyan-500 to-blue-600",
  "from-pink-500 to-rose-600",
  "from-emerald-500 to-teal-600",
  "from-amber-500 to-orange-500",
  "from-indigo-500 to-violet-600",
];

// ── Main handler ─────────────────────────────────────────────────
export async function GET() {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
    return NextResponse.json({ error: "Supabase não configurado." }, { status: 503 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Não autenticado." }, { status: 401 });
  }

  const admin = getSupabaseAdmin();
  const now = new Date();
  const nowIso = now.toISOString();

  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
  const startOfYesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1).toISOString();
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();

  // All DB queries run in parallel
  const [
    accountsTotalRes,
    accountsTodayRes,
    accountsYesterdayRes,
    accounts7dRes,
    accountsDownTotalRes,
    failoverLogs7dRes,
    postsPublishedTodayRes,
    queuePendingScheduledRes,
    queuePendingContainersRes,
    recentVideosRes,
    recentPostsRes,
    upcomingRes,
    viewsPostsRes,
  ] = await Promise.all([
    admin
      .from("instagram_accounts")
      .select("*", { count: "exact", head: true })
      .eq("user_id", user.id),
    admin
      .from("instagram_accounts")
      .select("*", { count: "exact", head: true })
      .eq("user_id", user.id)
      .gte("connected_at", startOfToday),
    admin
      .from("instagram_accounts")
      .select("*", { count: "exact", head: true })
      .eq("user_id", user.id)
      .gte("connected_at", startOfYesterday)
      .lt("connected_at", startOfToday),
    admin
      .from("instagram_accounts")
      .select("*", { count: "exact", head: true })
      .eq("user_id", user.id)
      .gte("connected_at", sevenDaysAgo),
    admin
      .from("instagram_accounts")
      .select("*", { count: "exact", head: true })
      .eq("user_id", user.id)
      .eq("health_status", "error"),
    admin
      .from("failover_logs")
      .select("failed_account_id, created_at")
      .eq("user_id", user.id)
      .gte("created_at", sevenDaysAgo),
    admin
      .from("scheduled_posts")
      .select("*", { count: "exact", head: true })
      .eq("user_id", user.id)
      .eq("status", "published")
      .gte("published_at", startOfToday),
    admin
      .from("scheduled_posts")
      .select("*", { count: "exact", head: true })
      .eq("user_id", user.id)
      .or("status.eq.pending,status.eq.publishing"),
    admin
      .from("pending_containers")
      .select("*", { count: "exact", head: true })
      .eq("user_id", user.id)
      .or("status.eq.pending,status.eq.publishing"),
    admin
      .from("videos_library")
      .select("owner_username, created_at")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(5),
    admin
      .from("scheduled_posts")
      .select("status, created_at, instagram_accounts(username)")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(5),
    admin
      .from("scheduled_posts")
      .select("scheduled_at, instagram_accounts(username)")
      .eq("user_id", user.id)
      .eq("status", "pending")
      .gt("scheduled_at", nowIso)
      .order("scheduled_at", { ascending: true })
      .limit(4),
    admin
      .from("scheduled_posts")
      .select("insights_plays, insights_fetched_at, instagram_accounts!inner(is_active, health_status)")
      .eq("user_id", user.id)
      .eq("status", "published")
      .eq("instagram_accounts.is_active", true)
      .neq("instagram_accounts.health_status", "error"),
  ]);

  // Contas Caídas — deduplica por conta dentro de cada janela (eventos de failover)
  const failoverRows = (failoverLogs7dRes.data ?? []) as { failed_account_id: string; created_at: string }[];
  const downToday = new Set<string>();
  const downYesterday = new Set<string>();
  const down7d = new Set<string>();
  const startOfTodayMs = new Date(startOfToday).getTime();
  const startOfYesterdayMs = new Date(startOfYesterday).getTime();
  for (const row of failoverRows) {
    const t = new Date(row.created_at).getTime();
    down7d.add(row.failed_account_id);
    if (t >= startOfTodayMs) downToday.add(row.failed_account_id);
    else if (t >= startOfYesterdayMs) downYesterday.add(row.failed_account_id);
  }

  const activity = [
    ...(recentVideosRes.data ?? []).map((v) => ({
      type: "download" as const,
      text: `Reel baixado de @${v.owner_username ?? "desconhecido"}`,
      status: "success" as const,
      created_at: v.created_at as string,
    })),
    ...(recentPostsRes.data ?? []).map((p) => {
      const account = p.instagram_accounts as unknown as { username: string } | null;
      const username = account?.username ?? "conta";
      const isError = p.status === "failed" || p.status === "cancelled";
      return {
        type: "schedule" as const,
        text: isError
          ? `Falha ao publicar em @${username}`
          : p.status === "published"
          ? `Postagem publicada em @${username}`
          : `Postagem agendada para @${username}`,
        status: isError ? ("error" as const) : ("success" as const),
        created_at: p.created_at as string,
      };
    }),
  ]
    .sort(
      (a, b) =>
        new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    )
    .slice(0, 5);

  const viewsRows = (viewsPostsRes.data ?? []) as unknown as {
    insights_plays: number | null;
    insights_fetched_at: string | null;
  }[];
  let viewsTotal = 0;
  let viewsTracked = 0;
  let viewsLastSyncedAt: string | null = null;
  for (const row of viewsRows) {
    if (row.insights_plays !== null) {
      viewsTotal += row.insights_plays;
      viewsTracked++;
    }
    if (row.insights_fetched_at && (!viewsLastSyncedAt || row.insights_fetched_at > viewsLastSyncedAt)) {
      viewsLastSyncedAt = row.insights_fetched_at;
    }
  }

  return NextResponse.json({
    accounts: {
      total: accountsTotalRes.count ?? 0,
      added_today: accountsTodayRes.count ?? 0,
      added_yesterday: accountsYesterdayRes.count ?? 0,
      added_7d: accounts7dRes.count ?? 0,
    },
    accounts_down: {
      total: accountsDownTotalRes.count ?? 0,
      down_today: downToday.size,
      down_yesterday: downYesterday.size,
      down_7d: down7d.size,
    },
    posts_today: {
      published: postsPublishedTodayRes.count ?? 0,
    },
    views: {
      total: viewsTotal,
      tracked_posts: viewsTracked,
      total_posts: viewsRows.length,
      last_synced_at: viewsLastSyncedAt,
    },
    queue: {
      pending: (queuePendingScheduledRes.count ?? 0) + (queuePendingContainersRes.count ?? 0),
    },
    recent_activity: activity,
    upcoming_posts: (upcomingRes.data ?? []).map((p, i) => ({
      account_username:
        (p.instagram_accounts as unknown as { username: string } | null)
          ?.username ?? "conta",
      scheduled_at: p.scheduled_at as string,
      gradient: GRADIENTS[i % GRADIENTS.length],
    })),
  });
}
