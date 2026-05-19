import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getSupabaseAdmin } from "@/lib/supabase";

export const dynamic = "force-dynamic";

const IG_API = "https://graph.instagram.com/v21.0";

interface StoryMedia {
  id: string;
  timestamp: string;
}

interface StoryResult {
  total: number;
  expiring_first_at: string | null; // ISO timestamp of oldest story (expires soonest)
}

async function fetchStoriesForAccount(
  igUserId: string,
  accessToken: string
): Promise<StoryMedia[]> {
  try {
    const url =
      `${IG_API}/${igUserId}/stories` +
      `?fields=id,timestamp` +
      `&access_token=${encodeURIComponent(accessToken)}`;

    const res = await fetch(url, { next: { revalidate: 0 } });
    if (!res.ok) return [];

    const json = await res.json();
    if (json.error || !Array.isArray(json.data)) return [];

    return json.data as StoryMedia[];
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

  // Fetch accounts that have a Meta token and IG business account ID
  const { data: accounts } = await admin
    .from("instagram_accounts")
    .select("ig_business_account_id, meta_access_token")
    .eq("user_id", user.id)
    .eq("is_active", true)
    .not("ig_business_account_id", "is", null)
    .not("meta_access_token", "is", null) as unknown as {
      data: { ig_business_account_id: string; meta_access_token: string }[] | null;
    };

  if (!accounts || accounts.length === 0) {
    return NextResponse.json<StoryResult>({ total: 0, expiring_first_at: null });
  }

  // Fetch stories for all accounts in parallel
  const allStories = (
    await Promise.all(
      accounts.map((acc) =>
        fetchStoriesForAccount(acc.ig_business_account_id, acc.meta_access_token)
      )
    )
  ).flat();

  if (allStories.length === 0) {
    return NextResponse.json<StoryResult>({ total: 0, expiring_first_at: null });
  }

  // The story expiring soonest is the one with the earliest timestamp
  const sorted = [...allStories].sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
  );

  return NextResponse.json<StoryResult>({
    total: allStories.length,
    expiring_first_at: sorted[0].timestamp,
  });
}
