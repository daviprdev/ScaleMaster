import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getSupabaseAdmin } from "@/lib/supabase";

export const runtime = "nodejs";
export const maxDuration = 120;

const GRAPH_API = "https://graph.instagram.com/v21.0";

interface AccountRow {
  id: string;
  user_id: string;
  username: string;
  followers_count: number | null;
  posts_count: number | null;
  meta_access_token: string | null;
  ig_business_account_id: string | null;
}

async function fetchProfileFromAPI(
  igId: string,
  token: string
): Promise<{ followers_count: number | null; posts_count: number | null }> {
  try {
    const res = await fetch(
      `${GRAPH_API}/${igId}?fields=followers_count,media_count&access_token=${token}`,
      { signal: AbortSignal.timeout(10_000) }
    );
    const data = (await res.json()) as {
      followers_count?: number;
      media_count?: number;
      error?: { message: string };
    };
    if (!res.ok || data.error) return { followers_count: null, posts_count: null };
    return {
      followers_count: data.followers_count ?? null,
      posts_count: data.media_count ?? null,
    };
  } catch {
    return { followers_count: null, posts_count: null };
  }
}

// ─── POST: CRON_SECRET (all users) or user session (scoped) ──────────────────

export async function POST(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization");

  let userId: string | null = null;
  let isCronCall = false;

  if (cronSecret && auth === `Bearer ${cronSecret}`) {
    isCronCall = true;
  } else {
    try {
      const supabase = await createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        userId = user.id;
      } else {
        return NextResponse.json({ error: "Não autenticado." }, { status: 401 });
      }
    } catch {
      return NextResponse.json({ error: "Não autenticado." }, { status: 401 });
    }
  }

  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
    return NextResponse.json({ skipped: true, reason: "Supabase não configurado." });
  }

  const admin = getSupabaseAdmin() as any;
  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD

  // Fetch accounts
  let query = admin
    .from("instagram_accounts")
    .select("id, user_id, username, followers_count, posts_count, meta_access_token, ig_business_account_id")
    .eq("is_active", true);

  if (!isCronCall && userId) query = query.eq("user_id", userId);

  const { data: accounts, error: accsErr } = await query;
  if (accsErr) return NextResponse.json({ error: accsErr.message }, { status: 500 });

  const rows = (accounts ?? []) as AccountRow[];
  const summary = { total: rows.length, synced: 0, api_refreshed: 0, skipped: 0, errors: 0 };

  for (const account of rows) {
    try {
      let followersCount = account.followers_count ?? 0;
      let postsCount = account.posts_count ?? null;

      // Get fresh data from Meta API if credentials exist
      if (account.meta_access_token && account.ig_business_account_id) {
        const fresh = await fetchProfileFromAPI(
          account.ig_business_account_id,
          account.meta_access_token
        );
        if (fresh.followers_count !== null) {
          followersCount = fresh.followers_count;
          postsCount = fresh.posts_count;
          summary.api_refreshed++;
          // Update live value in instagram_accounts
          await admin
            .from("instagram_accounts")
            .update({
              followers_count: followersCount,
              posts_count: postsCount,
              profile_refreshed_at: new Date().toISOString(),
            })
            .eq("id", account.id);
        }
      } else if (!account.meta_access_token) {
        summary.skipped++;
      }

      // Count automated posts published today
      const startOfDay = `${today}T00:00:00.000Z`;
      const endOfDay = `${today}T23:59:59.999Z`;
      const { count: postsToday } = await admin
        .from("scheduled_posts")
        .select("id", { count: "exact", head: true })
        .eq("account_id", account.id)
        .eq("status", "published")
        .gte("published_at", startOfDay)
        .lte("published_at", endOfDay);

      // Upsert today's snapshot
      const { error: upsertErr } = await admin
        .from("account_analytics_history")
        .upsert(
          {
            user_id: account.user_id,
            account_id: account.id,
            date: today,
            followers_count: followersCount,
            posts_count: postsCount ?? null,
            automated_posts_count: postsToday ?? 0,
          },
          { onConflict: "account_id,date" }
        );

      if (upsertErr) {
        console.error(`[analytics/sync] ✗ @${account.username}:`, upsertErr.message);
        summary.errors++;
      } else {
        summary.synced++;
        console.log(`[analytics/sync] ✓ @${account.username}: ${followersCount} seguidores, ${postsToday ?? 0} posts hoje.`);
      }
    } catch (err) {
      console.error(`[analytics/sync] ✗ @${account.username}:`, err instanceof Error ? err.message : String(err));
      summary.errors++;
    }
  }

  console.log("[analytics/sync] Resumo:", summary);
  return NextResponse.json({ ok: true, date: today, ...summary });
}
