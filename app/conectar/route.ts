import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { getAppUrl } from "@/lib/app-url";

export const dynamic = "force-dynamic";

/**
 * URL fixa para o redirecionador do destaque do Instagram.
 * Lê o token atual de magic_add_tokens e redireciona para /add/<token>/apps.
 * Não precisa atualizar o redirecionador quando o token rodar.
 */
export async function GET() {
  const admin = getSupabaseAdmin();
  const { data } = await admin
    .from("magic_add_tokens")
    .select("token")
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const APP_URL = getAppUrl();

  if (!data?.token) {
    return NextResponse.redirect(`${APP_URL}/add/error?reason=invalid_token`);
  }

  return NextResponse.redirect(`${APP_URL}/add/${data.token}/apps`, { status: 307 });
}
