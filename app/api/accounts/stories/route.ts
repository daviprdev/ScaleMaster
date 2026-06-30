import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { fetch as undiciFetch } from "undici";
import { getProxyForAccount, proxyInit } from "@/lib/proxy";

export const runtime = "nodejs";

interface AccountRow {
  id: string;
  ig_business_account_id: string;
  meta_access_token: string;
  proxy_url?: string | null;
}

interface StoryItem {
  id: string;
  timestamp: string;
}

async function fetchStoriesForAccount(
  acc: AccountRow
): Promise<{ id: string; stories: StoryItem[] }> {
  try {
    const proxy = getProxyForAccount(acc.id, acc.proxy_url ?? null);
    const url =
      `https://graph.instagram.com/v21.0/${acc.ig_business_account_id}/stories` +
      `?fields=id,timestamp` +
      `&access_token=${encodeURIComponent(acc.meta_access_token)}`;

    const res = await undiciFetch(url, { ...proxyInit(proxy), signal: AbortSignal.timeout(8_000) } as any);
    if (!res.ok) return { id: acc.id, stories: [] };
    const json = await res.json() as Record<string, unknown>;
    if ((json as any).error || !Array.isArray((json as any).data)) return { id: acc.id, stories: [] };
    return { id: acc.id, stories: (json as any).data as StoryItem[] };
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
    .select("id, ig_business_account_id, meta_access_token, proxy_url")
    .eq("user_id", user.id)
    .neq("health_status", "error")
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
