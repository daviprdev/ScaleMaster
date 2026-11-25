import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { montarUrlOAuth } from "@/lib/meta-oauth-url";
import { getAppUrl, getInstagramRedirectUri } from "@/lib/app-url";
import { signMagicUserCookie, signOAuthState } from "@/lib/oauth-cookie";

export const dynamic = "force-dynamic";

const REDIRECT_URI = getInstagramRedirectUri();
const APP_URL = getAppUrl();

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;

  if (!token) {
    return NextResponse.redirect(`${APP_URL}/add/error?reason=invalid_token`);
  }

  const admin = getSupabaseAdmin();

  // Valida o token e obtém user_id + app_id
  const { data: record, error } = await admin
    .from("magic_add_tokens")
    .select("user_id, app_id")
    .eq("token", token)
    .single();

  if (error || !record) {
    console.warn("[magic/add] Token inválido ou expirado:", `${String(token).slice(0, 6)}…`);
    return NextResponse.redirect(`${APP_URL}/add/error?reason=invalid_token`);
  }

  const { user_id: userId } = record;

  // Link geral: o app vem da tela de escolha (?app=<id> ou ?app=global);
  // sem o parâmetro vale o app salvo no link.
  const appParam = req.nextUrl.searchParams.get("app");
  const appId: string | null =
    appParam === null ? record.app_id : appParam === "global" ? null : appParam;

  // Resolve clientId do app
  let clientId: string;
  let configId: string | null = null;

  if (appId) {
    // select("*"): config_id pode não existir antes de supabase/user_meta_apps_unified.sql.
    const { data: app } = await admin
      .from("user_meta_apps")
      .select("*")
      .eq("id", appId)
      .eq("user_id", userId)
      .single();

    if (!app?.ig_app_id) {
      return NextResponse.redirect(`${APP_URL}/add/error?reason=app_not_found`);
    }
    clientId = app.ig_app_id;
    configId = app.config_id ?? null;
  } else {
    clientId = process.env.NEXT_PUBLIC_META_CLIENT_ID ?? "";
    configId = process.env.META_CONFIG_ID || null;
    if (!clientId) {
      return NextResponse.redirect(`${APP_URL}/add/error?reason=no_app_configured`);
    }
  }

  // Gera state CSRF assinado e com prazo (lib/oauth-cookie.ts) e monta URL OAuth
  const state = signOAuthState();
  const oauthUrl = montarUrlOAuth({ clientId, configId, redirectUri: REDIRECT_URI, state });

  const response = NextResponse.redirect(oauthUrl);

  const cookieOpts = {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge: 3600,
  };

  // Cookies de contexto OAuth — o callback lerá estes para saber a quem vincular a conta
  response.cookies.set("ig_oauth_state", state, cookieOpts);
  // Assinado com HMAC (userId|state|appId): o callback não tem sessão e confia
  // neste cookie para saber a quem vincular a conta.
  response.cookies.set("ig_oauth_magic_user_id", signMagicUserCookie(userId, state, appId ?? ""), cookieOpts);

  if (appId) {
    response.cookies.set("ig_oauth_app_id", appId, cookieOpts);
  } else {
    response.cookies.set("ig_oauth_app_id", "", { maxAge: 0, path: "/" });
  }

  return response;
}
