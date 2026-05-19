import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getSupabaseAdmin } from "@/lib/supabase";

export const runtime = "nodejs";

const GRADIENTS = [
  "from-violet-500 to-purple-600",
  "from-cyan-500 to-blue-600",
  "from-pink-500 to-rose-600",
  "from-emerald-500 to-teal-600",
  "from-amber-500 to-orange-500",
  "from-indigo-500 to-violet-600",
];

// ── Real Meta Graph API stories fetch ────────────────────────────
interface AccountToken {
  ig_business_account_id: string;
  meta_access_token: string;
}

interface StoryItem {
  id: string;
  timestamp: string;
}

async function fetchStoriesForAccount(acc: AccountToken): Promise<StoryItem[]> {
  try {
    const url =
      `https://graph.facebook.com/v19.0/${acc.ig_business_account_id}/stories` +
      `?fields=id,timestamp` +
      `&access_token=${encodeURIComponent(acc.meta_access_token)}`;

    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) return [];

    const json = await res.json();
    if (json.error || !Array.isArray(json.data)) return [];

    return json.data as StoryItem[];
  } catch {
    return [];
  }
}

async function fetchActiveStories(
  accounts: AccountToken[]
): Promise<{ total: number; expiring_first_at: string | null }> {
  if (accounts.length === 0) return { total: 0, expiring_first_at: null };

  const allStories = (
    await Promise.all(accounts.map(fetchStoriesForAccount))
  ).flat();

  if (allStories.length === 0) return { total: 0, expiring_first_at: null };

  // Oldest published story expires first (published at T → expires at T+24h)
  const sorted = [...allStories].sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
  );

  return {
    total: allStories.length,
    expiring_first_at: sorted[0].timestamp,
  };
}

// ── Main handler ─────────────────────────────────────────────────
export async function GET() {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
    return NextResponse.json(getMockStats());
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Não autenticado." }, { status: 401 });
  }

  const admin = getSupabaseAdmin();
  const now = new Date().toISOString();
  const startOfMonth = new Date(
    new Date().getFullYear(),
    new Date().getMonth(),
    1
  ).toISOString();
  const sevenDaysAgo = new Date(
    Date.now() - 7 * 24 * 60 * 60 * 1000
  ).toISOString();

  // All DB queries + tokens query run in parallel
  const [
    accountsTotalRes,
    accountsMonthRes,
    videosTotalRes,
    videosWeekRes,
    scheduledRes,
    publishedRes,
    recentVideosRes,
    recentPostsRes,
    upcomingRes,
    accountsWithTokensRes,
  ] = await Promise.all([
    admin
      .from("instagram_accounts")
      .select("*", { count: "exact", head: true })
      .eq("user_id", user.id),
    admin
      .from("instagram_accounts")
      .select("*", { count: "exact", head: true })
      .eq("user_id", user.id)
      .gte("connected_at", startOfMonth),
    admin
      .from("videos_library")
      .select("*", { count: "exact", head: true })
      .eq("user_id", user.id),
    admin
      .from("videos_library")
      .select("*", { count: "exact", head: true })
      .eq("user_id", user.id)
      .gte("created_at", sevenDaysAgo),
    admin
      .from("scheduled_posts")
      .select("scheduled_at", { count: "exact" })
      .eq("user_id", user.id)
      .eq("status", "pending")
      .gt("scheduled_at", now)
      .order("scheduled_at", { ascending: true })
      .limit(1),
    admin
      .from("scheduled_posts")
      .select("*", { count: "exact", head: true })
      .eq("user_id", user.id)
      .eq("status", "published"),
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
      .gt("scheduled_at", now)
      .order("scheduled_at", { ascending: true })
      .limit(4),
    // Accounts that have a valid Meta token — used for stories fetch
    admin
      .from("instagram_accounts")
      .select("ig_business_account_id, meta_access_token")
      .eq("user_id", user.id)
      .eq("is_active", true)
      .not("ig_business_account_id", "is", null)
      .not("meta_access_token", "is", null),
  ]);

  // Fetch stories from Meta Graph API with the real tokens obtained above
  const tokenedAccounts = (
    (accountsWithTokensRes.data ?? []) as unknown as AccountToken[]
  ).filter((a) => a.ig_business_account_id && a.meta_access_token);

  const stories = await fetchActiveStories(tokenedAccounts);

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

  return NextResponse.json({
    accounts: {
      total: accountsTotalRes.count ?? 0,
      this_month: accountsMonthRes.count ?? 0,
    },
    videos: {
      total: videosTotalRes.count ?? 0,
      this_week: videosWeekRes.count ?? 0,
    },
    scheduled: {
      pending: scheduledRes.count ?? 0,
      next_at:
        (scheduledRes.data?.[0] as { scheduled_at: string } | undefined)
          ?.scheduled_at ?? null,
    },
    published: {
      total: publishedRes.count ?? 0,
    },
    stories,
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

function getMockStats() {
  const now = Date.now();
  // Mock: 3 stories posted 10h, 14h and 20h ago → all still active
  const story1Posted = new Date(now - 10 * 60 * 60 * 1000).toISOString();
  const story2Posted = new Date(now - 14 * 60 * 60 * 1000).toISOString();
  const story3Posted = new Date(now - 20 * 60 * 60 * 1000).toISOString();
  return {
    accounts: { total: 4, this_month: 1 },
    videos: { total: 128, this_week: 23 },
    scheduled: {
      pending: 17,
      next_at: new Date(now + 2 * 60 * 60 * 1000).toISOString(),
    },
    published: { total: 42 },
    stories: {
      total: 3,
      // Oldest story (posted 20h ago) expires in 4h — expiring_first_at is its timestamp
      expiring_first_at: story3Posted,
    },
    recent_activity: [
      {
        type: "download",
        text: "Reel baixado de @fitness_brasil",
        status: "success",
        created_at: new Date(now - 12 * 60 * 1000).toISOString(),
      },
      {
        type: "schedule",
        text: "Postagem agendada para @minha_marca",
        status: "success",
        created_at: new Date(now - 35 * 60 * 1000).toISOString(),
      },
      {
        type: "download",
        text: "Reel baixado de @travel_vibes",
        status: "success",
        created_at: new Date(now - 60 * 60 * 1000).toISOString(),
      },
      {
        type: "schedule",
        text: "Falha ao publicar em @loja_teste",
        status: "error",
        created_at: new Date(now - 2 * 60 * 60 * 1000).toISOString(),
      },
      {
        type: "download",
        text: "Reel baixado de @travel_vibes",
        status: "success",
        created_at: new Date(now - 3 * 60 * 60 * 1000).toISOString(),
      },
    ],
    upcoming_posts: [
      {
        account_username: "minha_marca",
        scheduled_at: new Date(now + 2 * 60 * 60 * 1000).toISOString(),
        gradient: "from-violet-500 to-cyan-500",
      },
      {
        account_username: "loja_oficial",
        scheduled_at: new Date(now + 6 * 60 * 60 * 1000).toISOString(),
        gradient: "from-pink-500 to-orange-500",
      },
      {
        account_username: "minha_marca",
        scheduled_at: new Date(now + 24 * 60 * 60 * 1000).toISOString(),
        gradient: "from-emerald-500 to-teal-500",
      },
      {
        account_username: "loja_oficial",
        scheduled_at: new Date(now + 30 * 60 * 60 * 1000).toISOString(),
        gradient: "from-amber-500 to-orange-500",
      },
    ],
  };
}
