import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getSupabaseAdmin } from "@/lib/supabase";

export const runtime = "nodejs";

interface AccountRow {
  id: string;
  ig_business_account_id: string;
  meta_access_token: string;
}

interface StoryItem {
  id: string;
  timestamp: string;
}

async function fetchStoriesForAccount(
  acc: AccountRow
): Promise<{ id: string; stories: StoryItem[] }> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);

    const url =
      `https://graph.facebook.com/v19.0/${acc.ig_business_account_id}/stories` +
      `?fields=id,timestamp` +
      `&access_token=${encodeURIComponent(acc.meta_access_token)}`;

    const res = await fetch(url, { cache: "no-store", signal: controller.signal });
    clearTimeout(timer);

    if (!res.ok) return { id: acc.id, stories: [] };
    const json = await res.json();
    if (json.error || !Array.isArray(json.data)) return { id: acc.id, stories: [] };
    return { id: acc.id, stories: json.data as StoryItem[] };
  } catch {
    return { id: acc.id, stories: [] };
  }
}

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const admin = getSupabaseAdmin();
  const { data: accounts } = await admin
    .from("instagram_accounts")
    .select("id, ig_business_account_id, meta_access_token")
    .eq("user_id", user.id)
    .eq("is_active", true)
    .not("ig_business_account_id", "is", null)
    .not("meta_access_token", "is", null);

  if (!accounts || accounts.length === 0) {
    return NextResponse.json({ stories: {} });
  }

  const rows = (accounts as unknown as AccountRow[]).filter(
    (a) => a.ig_business_account_id && a.meta_access_token
  );

  const results = await Promise.allSettled(rows.map(fetchStoriesForAccount));

  const storiesMap: Record<string, { count: number; expiring_first_at: string | null }> = {};

  for (const result of results) {
    if (result.status !== "fulfilled") continue;
    const { id, stories } = result.value;
    if (stories.length === 0) {
      storiesMap[id] = { count: 0, expiring_first_at: null };
    } else {
      const sorted = [...stories].sort(
        (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
      );
      storiesMap[id] = { count: stories.length, expiring_first_at: sorted[0].timestamp };
    }
  }

  return NextResponse.json({ stories: storiesMap });
}
