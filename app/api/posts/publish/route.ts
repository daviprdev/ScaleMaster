import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { createClient } from "@/lib/supabase/server";
import { publishViaMetaAPI } from "@/lib/meta-publish";
import { refreshMetaToken, isTokenExpiringSoon } from "@/lib/meta-refresh";

export const runtime = "nodejs";
export const maxDuration = 120;

export interface PostResult {
  account_id: string;
  username: string;
  status: "ok" | "error";
  media_id?: string;
  code?: string;
  error?: string;
}

export async function POST(req: NextRequest) {
  const body = await req.json() as {
    video_id: string;
    account_ids: string[];
    caption?: string;
  };

  const { video_id, account_ids, caption = "" } = body;

  if (!video_id || !account_ids?.length) {
    return NextResponse.json(
      { error: "Os campos 'video_id' e 'account_ids' são obrigatórios." },
      { status: 400 }
    );
  }

  // Modo mock sem Supabase
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
    await new Promise(r => setTimeout(r, 1500));
    const results: PostResult[] = account_ids.map(id => ({
      account_id: id,
      username: "mock_user",
      status: "ok",
      media_id: `mock_${Date.now()}`,
    }));
    return NextResponse.json({ success: true, results, mock: true });
  }

  const admin = getSupabaseAdmin();

  const { data: video, error: videoErr } = await admin
    .from("videos_library")
    .select("public_url, filename")
    .eq("id", video_id)
    .single();

  if (videoErr || !video?.public_url) {
    return NextResponse.json({ error: "Vídeo não encontrado." }, { status: 404 });
  }

  const { data: accounts, error: accsErr } = await admin
    .from("instagram_accounts")
    .select("id, username, meta_access_token, ig_business_account_id, token_expires_at, fb_page_id")
    .in("id", account_ids)
    .eq("is_active", true);

  if (accsErr || !accounts?.length) {
    return NextResponse.json({ error: "Nenhuma conta ativa encontrada." }, { status: 404 });
  }

  const supabaseUser = await createClient();
  const { data: { user } } = await supabaseUser.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Usuário não autenticado." }, { status: 401 });
  }

  const results: PostResult[] = [];

  for (const account of accounts) {
    if (!account.meta_access_token || !account.ig_business_account_id) {
      results.push({
        account_id: account.id,
        username: account.username,
        status: "error",
        error: "Conta não conectada via Meta/Instagram. Reconecte a conta em Contas.",
      });
      continue;
    }

    let tokenToUse = account.meta_access_token;
    if (isTokenExpiringSoon(account.token_expires_at, 7)) {
      try {
        const { token, expiresAt } = await refreshMetaToken(account.meta_access_token, account.fb_page_id);
        await admin
          .from("instagram_accounts")
          .update({ meta_access_token: token, token_expires_at: expiresAt.toISOString() })
          .eq("id", account.id);
        tokenToUse = token;
        console.log(`[posts/publish] Token renovado automaticamente para @${account.username}`);
      } catch (refreshErr) {
        console.warn(`[posts/publish] Falha ao renovar token para @${account.username}:`, refreshErr);
      }
    }

    const metaResult = await publishViaMetaAPI(
      account.ig_business_account_id,
      tokenToUse,
      video.public_url,
      caption
    );
    results.push({
      account_id: account.id,
      username: account.username,
      status: metaResult.status,
      media_id: metaResult.media_id,
      error: metaResult.error,
    });
  }

  const allOk = results.every(r => r.status === "ok");
  return NextResponse.json({ success: allOk, results });
}
