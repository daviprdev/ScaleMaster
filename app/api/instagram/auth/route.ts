import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { getMetaApp, getMetaApps } from "@/lib/meta-apps";

export const dynamic = "force-dynamic";

const SCOPES = [
  "instagram_basic",
  "instagram_content_publish",
  "pages_show_list",
  "pages_read_engagement",
].join(",");

export async function GET(req: NextRequest) {
  const appUrl = (process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
  const redirectUri = `${appUrl}/api/instagram/callback`;

  const { searchParams } = new URL(req.url);
  const requestedAppId = searchParams.get("app_id");

  const app = requestedAppId
    ? getMetaApp(requestedAppId)
    : getMetaApps()[0] ?? null;

  if (!app) {
    return NextResponse.json(
      { error: "Nenhum Meta App configurado. Adicione META_APP1_CLIENT_ID e META_APP1_CLIENT_SECRET." },
      { status: 500 }
    );
  }

  // state = "{appId}:{uuid}" para recuperar o app_secret no callback
  const state = `${app.id}:${crypto.randomUUID()}`;

  const oauthUrl =
    `https://www.facebook.com/v19.0/dialog/oauth` +
    `?client_id=${app.clientId}` +
    `&redirect_uri=${encodeURIComponent(redirectUri)}` +
    `&scope=${SCOPES}` +
    `&response_type=code` +
    `&state=${encodeURIComponent(state)}`;

  // ?debug=1 → inspecionar sem redirecionar
  if (searchParams.get("debug") === "1") {
    return NextResponse.json({ oauthUrl, clientId: app.clientId, redirectUri, scopes: SCOPES, appId: app.id });
  }

  console.log("[instagram/auth] redirectUri:", redirectUri, "| app:", app.id);

  const response = NextResponse.redirect(oauthUrl);
  response.cookies.set("ig_oauth_state", state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 600,
    path: "/",
  });
  return response;
}
