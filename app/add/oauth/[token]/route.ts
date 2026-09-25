import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import crypto from "crypto";
import { decrypt } from "@/lib/encrypt";

export const dynamic = "force-dynamic";

const REDIRECT_URI = "https://autoscale-ia.vercel.app/api/instagram/callback";
const APP_URL = (process.env.NEXT_PUBLIC_APP_URL ?? "https://autoscale-ia.vercel.app").replace(/\/$/, "");

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
    console.warn("[magic/add] Token inválido ou expirado:", token);
    return NextResponse.redirect(`${APP_URL}/add/error?reason=invalid_token`);
  }

  const { user_id: userId, app_id: appId } = record;

  // Resolve clientId do app
  let clientId: string;

  if (appId) {
    const { data: app } = await admin
      .from("user_meta_apps")
      .select("ig_app_id, ig_app_secret")
      .eq("id", appId)
      .eq("user_id", userId)
      .single();

    if (!app?.ig_app_id) {
      return NextResponse.redirect(`${APP_URL}/add/error?reason=app_not_found`);
    }
    clientId = app.ig_app_id;
  } else {
    clientId = process.env.NEXT_PUBLIC_META_CLIENT_ID ?? "";
    if (!clientId) {
      return NextResponse.redirect(`${APP_URL}/add/error?reason=no_app_configured`);
    }
  }

  // Gera state CSRF e monta URL OAuth
  const state = crypto.randomUUID();
  const oauthUrl =
    "https://www.instagram.com/oauth/authorize" +
    "?client_id=" + clientId +
    "&redirect_uri=" + encodeURIComponent(REDIRECT_URI) +
    "&scope=instagram_business_basic,instagram_business_content_publish,instagram_business_manage_comments,instagram_business_manage_insights" +
    "&response_type=code" +
    "&state=" + state;

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
  response.cookies.set("ig_oauth_magic_user_id", userId, cookieOpts);

  if (appId) {
    response.cookies.set("ig_oauth_app_id", appId, cookieOpts);
  } else {
    response.cookies.set("ig_oauth_app_id", "", { maxAge: 0, path: "/" });
  }

  return response;
}
