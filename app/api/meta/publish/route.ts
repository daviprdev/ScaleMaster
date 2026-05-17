import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { createClient } from "@/lib/supabase/server";
import { publishViaMetaAPI } from "@/lib/meta-publish";

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
    .select("id, username, meta_access_token, ig_business_account_id")
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

  const result = await publishViaMetaAPI(
    account.ig_business_account_id,
    account.meta_access_token,
    video_url,
    caption
  );

  if (result.status === "ok") {
    return NextResponse.json({ success: true, media_id: result.media_id });
  }
  return NextResponse.json({ success: false, error: result.error }, { status: 500 });
}
