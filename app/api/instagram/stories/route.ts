import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getSupabaseAdmin } from "@/lib/supabase";

export const dynamic = "force-dynamic";

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
      `https://graph.instagram.com/v21.0/${acc.ig_business_account_id}/stories` +
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

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = getSupabaseAdmin();

  const { data: accounts } = await admin
    .from("instagram_accounts")
    .select("ig_business_account_id, meta_access_token")
    .eq("user_id", user.id)
    .eq("is_active", true)
    .not("ig_business_account_id", "is", null)
    .not("meta_access_token", "is", null) as unknown as {
      data: AccountToken[] | null;
    };

  const tokenedAccounts = (accounts ?? []).filter(
    (a) => a.ig_business_account_id && a.meta_access_token
  );

  if (tokenedAccounts.length === 0) {
    return NextResponse.json({ total: 0, expiring_first_at: null });
  }

  const allStories = (
    await Promise.all(tokenedAccounts.map(fetchStoriesForAccount))
  ).flat();

  if (allStories.length === 0) {
    return NextResponse.json({ total: 0, expiring_first_at: null });
  }

  // Oldest published story expires soonest
  const sorted = [...allStories].sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
  );

  return NextResponse.json({
    total: allStories.length,
    expiring_first_at: sorted[0].timestamp,
  });
}
