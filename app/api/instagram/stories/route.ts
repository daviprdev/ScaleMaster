import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { fetch as undiciFetch } from "undici";
import { getProxyForAccount, proxyInit } from "@/lib/proxy";

export const dynamic = "force-dynamic";

interface AccountToken {
  id: string;
  ig_business_account_id: string;
  meta_access_token: string;
  proxy_url?: string | null;
}

interface StoryItem {
  id: string;
  timestamp: string;
}

async function fetchStoriesForAccount(acc: AccountToken): Promise<StoryItem[]> {
  try {
    const proxy = getProxyForAccount(acc.id, acc.proxy_url ?? null);
    const url =
      `https://graph.instagram.com/v21.0/${acc.ig_business_account_id}/stories` +
      `?fields=id,timestamp` +
      `&access_token=${encodeURIComponent(acc.meta_access_token)}`;

    const res = await undiciFetch(url, { ...proxyInit(proxy), signal: AbortSignal.timeout(10_000) } as any);
    if (!res.ok) return [];

    const json = await res.json() as Record<string, unknown>;
    if ((json as any).error || !Array.isArray((json as any).data)) return [];

    return (json as any).data as StoryItem[];
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
    .select("id, ig_business_account_id, meta_access_token, proxy_url")
    .eq("user_id", user.id)
    .neq("health_status", "error")
    .not("ig_business_account_id", "is", null)
    .not("meta_access_token", "is", null)
    // Política sem-proxy-sem-sync: conta sem proxy dedicado não gera NENHUMA
    // requisição à Meta em nome dela (antes saía pelo IP datacenter da Vercel).
    .not("proxy_url", "is", null) as unknown as {
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
