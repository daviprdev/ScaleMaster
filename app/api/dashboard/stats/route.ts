import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { brtMidnightUtc, brtMonthStartUtc } from "@/lib/brt-time";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const GRADIENTS = [
  "from-[#00498D] to-[#00346D]",
  "from-[#85B9E9] to-[#00498D]",
  "from-pink-500 to-rose-600",
  "from-emerald-500 to-teal-600",
  "from-amber-500 to-orange-500",
  "from-[#00346D] to-[#00498D]",
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

  // Meia-noite de Brasília — o container roda em UTC, então `new Date(y, m, d)`
  // virava o dia às 21h BRT.
  const startOfToday = brtMidnightUtc(0).toISOString();
  const startOfYesterday = brtMidnightUtc(1).toISOString();
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
    loopPublishedTodayRes,
    queuePendingScheduledRes,
    queuePendingContainersRes,
    recentVideosRes,
    recentPostsRes,
    upcomingRes,
    viewsPostsRes,
    salesRes,
    reelsRes,
    accountsActiveTodayRes,
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
      .from("pending_containers")
      .select("*", { count: "exact", head: true })
      .eq("user_id", user.id)
      .eq("status", "published")
      .gte("created_at", startOfToday),
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
    // Views REAIS das contas (insight de conta da Meta, por dia) — o mesmo
    // número do painel profissional do Instagram. Somar só os posts que o SaaS
    // registrou subestimava: a conta tem posts que o SaaS não conhece
    // (medido: 18.835 na conta vs 13 somando posts do SaaS).
    (admin as unknown as {
      rpc: (fn: string, args: Record<string, unknown>) => Promise<{
        data: {
          total: number; today: number; yesterday: number; last_7d: number; last_30d: number;
          month: number; prev_month: number; today_has_data: boolean;
          accounts_total: number; accounts_synced: number; last_synced_at: string | null;
        } | null;
        error: { message: string } | null;
      }>;
    }).rpc("get_account_views_summary", { p_user_id: user.id }),
    // Vendas são globais (do dono do SaaS via ApexVips/SharkBot), não por usuário final.
    // Removido filtro .eq("user_id", user.id) para mostrar o total real.
    admin
      .from("sales")
      .select("amount, created_at")
      .not("amount", "is", null),
    // Reels publicados — lidos da lista de mídias de cada conta na Meta
    // (account_reels_daily). Contar scheduled_posts zerava o card quando a
    // campanha era excluída com "apagar posts".
    (admin as unknown as {
      rpc: (fn: string) => Promise<{
        data: {
          total: number; today: number; yesterday: number; last_7d: number; month: number;
          accounts_synced: number;
        } | null;
        error: { message: string } | null;
      }>;
    }).rpc("get_reels_summary"),
    // Contas ativas hoje — o sistema grava 'online' | 'error' | 'blocked';
    // filtrar por 'ok' (valor que nunca é gravado) deixava o card sempre em 0.
    admin
      .from("instagram_accounts")
      .select("*", { count: "exact", head: true })
      .eq("user_id", user.id)
      .eq("health_status", "online"),
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

  if (viewsPostsRes.error) {
    console.error("[dashboard/stats] get_account_views_summary falhou:", viewsPostsRes.error.message);
  }
  const viewsSummary = viewsPostsRes.data;

  if (reelsRes.error) {
    console.error("[dashboard/stats] get_reels_summary falhou:", reelsRes.error.message);
  }
  const reelsSummary = reelsRes.data;

  const salesRows = (salesRes.data ?? []) as { amount: number | null; created_at: string }[];
  const monthStartIso = brtMonthStartUtc(0).toISOString();
  const prevMonthStartIso = brtMonthStartUtc(1).toISOString();
  const sumSales = (sinceIso: string) =>
    salesRows.filter((r) => r.created_at >= sinceIso).reduce((acc, r) => acc + Number(r.amount ?? 0), 0);
  const sumRange = (sinceIso: string, untilIso: string) =>
    salesRows
      .filter((r) => r.created_at >= sinceIso && r.created_at < untilIso)
      .reduce((acc, r) => acc + Number(r.amount ?? 0), 0);

  return NextResponse.json({
    sales: {
      today: sumSales(startOfToday),
      yesterday: sumRange(startOfYesterday, startOfToday),
      month: sumSales(monthStartIso),
      prev_month: sumRange(prevMonthStartIso, monthStartIso),
    },
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
      published: (postsPublishedTodayRes.count ?? 0) + (loopPublishedTodayRes.count ?? 0),
      scheduled: postsPublishedTodayRes.count ?? 0,
      loop: loopPublishedTodayRes.count ?? 0,
    },
    views: {
      // Buckets são dias UTC (única granularidade em que a Meta soma sem
      // sobreposição), mas "hoje" é escolhido pela data de Brasília: o card
      // vira à meia-noite BRT. `total` soma todas as contas, inclusive as
      // caídas. Ver supabase/account_views_total_all_accounts.sql.
      total: Number(viewsSummary?.total ?? 0),
      today: Number(viewsSummary?.today ?? 0),
      yesterday: Number(viewsSummary?.yesterday ?? 0),
      last_7d: Number(viewsSummary?.last_7d ?? 0),
      last_30d: Number(viewsSummary?.last_30d ?? 0),
      month: Number(viewsSummary?.month ?? 0),
      prev_month: Number(viewsSummary?.prev_month ?? 0),
      today_has_data: Boolean(viewsSummary?.today_has_data),
      accounts_total: Number(viewsSummary?.accounts_total ?? 0),
      accounts_synced: Number(viewsSummary?.accounts_synced ?? 0),
      last_synced_at: viewsSummary?.last_synced_at ?? null,
    },
    videos_published: {
      total: Number(reelsSummary?.total ?? 0),
      today: Number(reelsSummary?.today ?? 0),
      yesterday: Number(reelsSummary?.yesterday ?? 0),
      last_7d: Number(reelsSummary?.last_7d ?? 0),
      month: Number(reelsSummary?.month ?? 0),
      accounts_synced: Number(reelsSummary?.accounts_synced ?? 0),
    },
    accounts_active_today: accountsActiveTodayRes.count ?? 0,
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
