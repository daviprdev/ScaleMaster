import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { getMetaApp, getMetaApps } from "@/lib/meta-apps";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const appUrl = (process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
  const redirectUri = `${appUrl}/api/meta/callback`;

  const { searchParams } = new URL(req.url);
  const requestedAppId = searchParams.get("app_id");

  // Resolve o app a usar: parâmetro explícito → primeiro disponível
  const app = requestedAppId
    ? getMetaApp(requestedAppId)
    : getMetaApps()[0] ?? null;

  if (!app) {
    return NextResponse.json(
      { error: "Nenhum Meta App configurado. Adicione META_APP1_CLIENT_ID e META_APP1_CLIENT_SECRET ao .env.local." },
      { status: 500 }
    );
  }

  // State = "{appId}:{uuid}" — app_id recuperado no callback para CSRF + seleção do secret
  const uuid = crypto.randomUUID();
  const state = `${app.id}:${uuid}`;

  const params = new URLSearchParams({
    client_id: app.clientId,
    redirect_uri: redirectUri,
    scope: "instagram_business_basic,instagram_business_content_publish,instagram_business_manage_insights",
    response_type: "code",
    state,
  });

  const response = NextResponse.redirect(
    `https://api.instagram.com/oauth/authorize?${params}`
  );

  response.cookies.set("meta_oauth_state", state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 600,
    path: "/",
  });

  return response;
}
