import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { fetch as undiciFetch } from "undici";
import { getProxyForAccount, proxyInit } from "@/lib/proxy";

export const dynamic = "force-dynamic";

const GRAPH_API = "https://graph.instagram.com/v21.0";

interface PostWithAccount {
  id: string;
  media_id: string | null;
  account_id: string;
  instagram_accounts: {
    id: string;
    meta_access_token: string | null;
    ig_business_account_id: string | null;
    proxy_url?: string | null;
  } | null;
}

interface InsightsResult {
  likes: number | null;
  comments: number | null;
  reach: number | null;
  plays: number | null;
  shares: number | null;
  saved: number | null;
}

async function fetchBasicMetrics(
  mediaId: string,
  token: string,
  proxy: ReturnType<typeof getProxyForAccount>
): Promise<{ likes: number | null; comments: number | null }> {
  const res = await undiciFetch(
    `${GRAPH_API}/${mediaId}?fields=like_count,comments_count&access_token=${encodeURIComponent(token)}`,
    proxyInit(proxy) as any
  );
  const data = (await res.json()) as {
    like_count?: number;
    comments_count?: number;
    error?: { message: string };
  };
  if (!res.ok) return { likes: null, comments: null };
  return {
    likes: data.like_count ?? null,
    comments: data.comments_count ?? null,
  };
}

async function fetchInsightsMetrics(
  mediaId: string,
  token: string,
  proxy: ReturnType<typeof getProxyForAccount>
): Promise<{ reach: number | null; plays: number | null; shares: number | null; saved: number | null }> {
  const metrics = ["reach", "plays", "shares", "saved"].join(",");
  const res = await undiciFetch(
    `${GRAPH_API}/${mediaId}/insights?metric=${metrics}&period=lifetime&access_token=${encodeURIComponent(token)}`,
    proxyInit(proxy) as any
  );
  const data = (await res.json()) as {
    data?: Array<{ name: string; values: Array<{ value: number }> }>;
    error?: { message: string; code?: number };
  };

  if (!res.ok || data.error) return { reach: null, plays: null, shares: null, saved: null };

  const get = (name: string): number | null =>
    data.data?.find((m) => m.name === name)?.values?.[0]?.value ?? null;

  return {
    reach: get("reach"),
    plays: get("plays"),
    shares: get("shares"),
    saved: get("saved"),
  };
}

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });

  const body = (await req.json()) as { post_id?: string };
  if (!body.post_id) return NextResponse.json({ error: "post_id obrigatório." }, { status: 400 });

  const admin = getSupabaseAdmin();

  const { data: rawPost, error: postErr } = await admin
    .from("scheduled_posts")
    .select(
      "id, media_id, account_id, " +
      "instagram_accounts(id, meta_access_token, ig_business_account_id, proxy_url)"
    )
    .eq("id", body.post_id)
    .eq("status", "published")
    .single();

  if (postErr || !rawPost) {
    return NextResponse.json({ error: "Post não encontrado ou não publicado." }, { status: 404 });
  }

  const post = rawPost as unknown as PostWithAccount;
  const account = Array.isArray(post.instagram_accounts)
    ? post.instagram_accounts[0]
    : post.instagram_accounts;

  if (!account?.meta_access_token || !post.media_id) {
    return NextResponse.json({ error: "Token ou media_id indisponível." }, { status: 422 });
  }

  const proxy = getProxyForAccount(account.id, account.proxy_url ?? null);

  const [basic, advanced] = await Promise.all([
    fetchBasicMetrics(post.media_id, account.meta_access_token, proxy),
    fetchInsightsMetrics(post.media_id, account.meta_access_token, proxy),
  ]);

  const metrics: InsightsResult = {
    likes: basic.likes,
    comments: basic.comments,
    reach: advanced.reach,
    plays: advanced.plays,
    shares: advanced.shares,
    saved: advanced.saved,
  };

  // Cast required — new insight columns not yet in generated Supabase types
  await admin
    .from("scheduled_posts")
    .update({
      insights_likes: metrics.likes,
      insights_comments: metrics.comments,
      insights_reach: metrics.reach,
      insights_plays: metrics.plays,
      insights_shares: metrics.shares,
      insights_saved: metrics.saved,
      insights_fetched_at: new Date().toISOString(),
    } as unknown as Record<string, unknown>)
    .eq("id", body.post_id);

  return NextResponse.json({ ok: true, metrics });
}
