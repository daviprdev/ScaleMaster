import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { getProxyForAccount } from "@/lib/proxy";
import { fetchPostInsights, type PostInsights } from "@/lib/meta-insights";

export const dynamic = "force-dynamic";

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

  const metrics: PostInsights = await fetchPostInsights(post.media_id, account.meta_access_token, proxy);

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
