import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const clientId = process.env.NEXT_PUBLIC_META_CLIENT_ID!;
  const clientSecret = process.env.META_CLIENT_SECRET!;
  const redirectUri = "https://autoscale-ia.vercel.app/api/instagram/callback";

  const state = crypto.randomUUID();

  const oauthUrl =
    `https://www.facebook.com/v19.0/dialog/oauth` +
    `?client_id=${clientId}` +
    `&redirect_uri=${encodeURIComponent(redirectUri)}` +
    `&scope=instagram_basic,instagram_content_publish,pages_show_list,pages_read_engagement` +
    `&response_type=code` +
    `&state=${encodeURIComponent(state)}`;

  // ?debug=1 → retorna JSON para diagnóstico sem redirecionar
  if (new URL(req.url).searchParams.get("debug") === "1") {
    return NextResponse.json({
      oauthUrl,
      clientId,
      hasSecret: !!clientSecret,
      redirectUri,
    });
  }

  console.log("[instagram/auth] oauthUrl:", oauthUrl);

  const response = NextResponse.redirect(oauthUrl);
  response.cookies.set("ig_oauth_state", state, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    maxAge: 600,
    path: "/",
  });
  return response;
}
