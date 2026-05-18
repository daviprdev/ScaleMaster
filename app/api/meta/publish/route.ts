import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { createClient } from "@/lib/supabase/server";
import { publishViaMetaAPI } from "@/lib/meta-publish";
import { refreshMetaToken, isTokenExpiringSoon } from "@/lib/meta-refresh";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(req: NextRequest) {
  const body = (await req.json()) as {
    account_id: string;
    video_url: string;
    caption?: string;
  };

  const { account_id, video_url, caption = "" } = body;

  if (!account_id || !video_url) {
    return NextResponse.json(
      { error: "Os campos 'account_id' e 'video_url' são obrigatórios." },
      { status: 400 }
    );
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Não autenticado." }, { status: 401 });
  }

  const admin = getSupabaseAdmin();
  const { data: account, error: accErr } = await admin
    .from("instagram_accounts")
    .select("id, username, meta_access_token, ig_business_account_id, token_expires_at")
    .eq("id", account_id)
    .eq("user_id", user.id)
    .single();

  if (accErr || !account) {
    return NextResponse.json({ error: "Conta não encontrada." }, { status: 404 });
  }
  if (!account.meta_access_token || !account.ig_business_account_id) {
    return NextResponse.json(
      { error: "Conta não conectada via Meta API. Reconecte em Contas." },
      { status: 400 }
    );
  }

  // Auto-renova token se expira em menos de 7 dias
  let tokenToUse = account.meta_access_token;
  if (isTokenExpiringSoon(account.token_expires_at, 7)) {
    try {
      const { token, expiresAt } = await refreshMetaToken(account.meta_access_token);
      await admin
        .from("instagram_accounts")
        .update({ meta_access_token: token, token_expires_at: expiresAt.toISOString() })
        .eq("id", account_id);
      tokenToUse = token;
      console.log(`[meta/publish] Token renovado automaticamente para @${account.username}`);
    } catch (refreshErr) {
      console.warn(`[meta/publish] Falha ao renovar token para @${account.username}:`, refreshErr);
    }
  }

  const result = await publishViaMetaAPI(
    account.ig_business_account_id,
    tokenToUse,
    video_url,
    caption
  );

  if (result.status === "ok") {
    return NextResponse.json({ success: true, media_id: result.media_id });
  }
  return NextResponse.json({ success: false, error: result.error }, { status: 500 });
}
