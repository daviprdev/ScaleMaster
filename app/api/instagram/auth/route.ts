import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { getMetaApp, getMetaApps } from "@/lib/meta-apps";

export const dynamic = "force-dynamic";

// Scopes do Instagram Login API (api.instagram.com)
const SCOPES = [
  "instagram_business_basic",
  "instagram_business_content_publish",
  "instagram_business_manage_insights",
].join(",");

export async function GET(req: NextRequest) {
  const appUrl = (process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
  const redirectUri = `${appUrl}/api/meta/callback`;

  console.log("[instagram/auth] redirectUri:", redirectUri);

  const { searchParams } = new URL(req.url);
  const requestedAppId = searchParams.get("app_id");

  // Resolve o app: parâmetro explícito → primeiro disponível
  const app = requestedAppId
    ? getMetaApp(requestedAppId)
    : getMetaApps()[0] ?? null;

  if (!app) {
    return NextResponse.json(
      { error: "Nenhum Meta App configurado. Adicione META_APP1_CLIENT_ID e META_APP1_CLIENT_SECRET ao .env.local." },
      { status: 500 }
    );
  }

  // State = "{appId}:{uuid}" — recuperado no callback para CSRF + seleção do secret
  const uuid = crypto.randomUUID();
  const state = `${app.id}:${uuid}`;

  // Monta a URL manualmente para não codificar as vírgulas do scope (%2C quebra o Instagram OAuth)
  const oauthUrl =
    `https://api.instagram.com/oauth/authorize` +
    `?client_id=${app.clientId}` +
    `&redirect_uri=${encodeURIComponent(redirectUri)}` +
    `&scope=${SCOPES}` +
    `&response_type=code` +
    `&state=${encodeURIComponent(state)}`;

  // ?debug=1 → retorna a URL sem redirecionar (diagnóstico)
  if (searchParams.get("debug") === "1") {
    return NextResponse.json({
      oauthUrl,
      clientId: app.clientId,
      redirectUri,
      scopes: SCOPES,
      appId: app.id,
    });
  }

  const response = NextResponse.redirect(oauthUrl);

  response.cookies.set("meta_oauth_state", state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 600,
    path: "/",
  });

  return response;
}
