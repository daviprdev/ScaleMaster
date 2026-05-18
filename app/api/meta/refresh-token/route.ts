import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { refreshMetaToken } from "@/lib/meta-refresh";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });

  const { account_id } = (await req.json()) as { account_id?: string };
  if (!account_id) {
    return NextResponse.json({ error: "account_id obrigatório." }, { status: 400 });
  }

  const admin = getSupabaseAdmin();
  const { data: account } = await admin
    .from("instagram_accounts")
    .select("id, meta_access_token, username")
    .eq("id", account_id)
    .eq("user_id", user.id)
    .maybeSingle();

  if (!account) {
    return NextResponse.json({ error: "Conta não encontrada." }, { status: 404 });
  }
  if (!account.meta_access_token) {
    return NextResponse.json({ error: "Conta não tem token Meta." }, { status: 400 });
  }

  try {
    const { token, expiresAt } = await refreshMetaToken(account.meta_access_token);

    await admin
      .from("instagram_accounts")
      .update({
        meta_access_token: token,
        token_expires_at: expiresAt.toISOString(),
      })
      .eq("id", account_id);

    console.log(
      `[meta/refresh-token] Token renovado para @${account.username}, expira: ${expiresAt.toISOString()}`
    );

    return NextResponse.json({ ok: true, expires_at: expiresAt.toISOString() });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[meta/refresh-token] Erro:", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
