import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const clientId = process.env.NEXT_PUBLIC_INSTAGRAM_APP_ID;

  if (!clientId) {
    return NextResponse.json(
      { error: "NEXT_PUBLIC_INSTAGRAM_APP_ID não configurada." },
      { status: 500 }
    );
  }

  const state = crypto.randomUUID();
  const redirectUri = "https://autoscale-ia.vercel.app/api/instagram/callback";

  const oauthUrl =
    "https://api.instagram.com/oauth/authorize" +
    "?client_id=" + clientId +
    "&redirect_uri=" + encodeURIComponent(redirectUri) +
    "&scope=instagram_business_basic,instagram_business_content_publish" +
    "&response_type=code" +
    "&state=" + state;

  const response = NextResponse.redirect(oauthUrl);
  response.cookies.set("ig_oauth_state", state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 3600,
  });
  return response;
}
