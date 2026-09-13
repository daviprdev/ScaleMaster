import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { fetchPostInsights, insightsUpdatePayload, type PostInsights } from "@/lib/meta-insights";

export const dynamic = "force-dynamic";

interface PostWithAccount {
  id: string;
  media_id: string | null;
  account_id: string;
  post_type: string | null;
  instagram_accounts: {
    id: string;
    meta_access_token: string | null;
    ig_business_account_id: string | null;
  } | null;
}

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as { post_id?: string };
  if (!body.post_id) return NextResponse.json({ error: "post_id obrigatório." }, { status: 400 });

  const admin = getSupabaseAdmin();

  const { data: rawPost, error: postErr } = await admin
    .from("scheduled_posts")
    .select(
      "id, media_id, account_id, post_type, " +
      "instagram_accounts(id, meta_access_token, ig_business_account_id)"
    )
    .eq("id", body.post_id)
    .eq("user_id", user.id)
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


  const metrics: PostInsights = await fetchPostInsights(
    post.media_id,
    account.meta_access_token,
    post.post_type === "story" ? "story" : "reel"
  );

  // Só grava métricas obtidas — falha na Meta não apaga views já salvas.
  await admin
    .from("scheduled_posts")
    .update(insightsUpdatePayload(metrics) as never)
    .eq("id", body.post_id);

  return NextResponse.json({ ok: true, metrics });
}
