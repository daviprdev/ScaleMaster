import { NextResponse } from "next/server";
import crypto from "crypto";

export const dynamic = "force-dynamic";

export async function GET() {
  const clientId = process.env.NEXT_PUBLIC_META_CLIENT_ID;
  const appUrl = (process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
  const redirectUri = `${appUrl}/api/meta/callback`;

  if (!clientId) {
    console.error("[meta/auth] NEXT_PUBLIC_META_CLIENT_ID não configurado.");
    return NextResponse.json(
      {
        error:
          "Meta App ID não configurado. Adicione NEXT_PUBLIC_META_CLIENT_ID ao .env.local " +
          "e NEXT_PUBLIC_APP_URL com a URL base da aplicação.",
      },
      { status: 500 }
    );
  }

  const state = crypto.randomUUID();

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: [
      "instagram_basic",
      "instagram_content_publish",
      "instagram_manage_insights",
      "pages_show_list",
      "pages_read_engagement",
    ].join(","),
    response_type: "code",
    state,
  });

  const oauthUrl = `https://www.facebook.com/v19.0/dialog/oauth?${params}`;

  const response = NextResponse.redirect(oauthUrl);

  // Armazena state em cookie httpOnly para verificação CSRF no callback
  response.cookies.set("meta_oauth_state", state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 600, // 10 minutos
    path: "/",
  });

  return response;
}
