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

  return new Response(null, {
    status: 302,
    headers: {
      Location: oauthUrl,
      "Set-Cookie": `ig_oauth_state=${state}; HttpOnly; Secure; SameSite=Lax; Max-Age=600; Path=/`,
    },
  });
}
