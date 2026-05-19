import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";

export const dynamic = "force-dynamic";

// Instagram App ID — variável dedicada tem prioridade sobre o App ID do Facebook
const IG_APP_ID =
  process.env.NEXT_PUBLIC_INSTAGRAM_APP_ID ??
  process.env.NEXT_PUBLIC_META_CLIENT_ID ??
  "";

// Scopes montados como string literal — vírgulas NÃO podem ser %2C no api.instagram.com
const SCOPES =
  "instagram_business_basic,instagram_business_content_publish,instagram_business_manage_insights";

const REDIRECT_URI = "https://autoscale-ia.vercel.app/api/instagram/callback";

export async function GET(req: NextRequest) {
  if (!IG_APP_ID) {
    return NextResponse.json(
      { error: "NEXT_PUBLIC_INSTAGRAM_APP_ID não configurado na Vercel." },
      { status: 500 }
    );
  }

  const state = crypto.randomUUID();

  // URL montada manualmente — NÃO usar URLSearchParams para o scope
  const oauthUrl =
    `https://api.instagram.com/oauth/authorize` +
    `?client_id=${IG_APP_ID}` +
    `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}` +
    `&scope=${SCOPES}` +
    `&response_type=code` +
    `&state=${encodeURIComponent(state)}`;

  const { searchParams } = new URL(req.url);
  if (searchParams.get("debug") === "1") {
    return NextResponse.json({ oauthUrl, client_id: IG_APP_ID, redirect_uri: REDIRECT_URI, scopes: SCOPES });
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
