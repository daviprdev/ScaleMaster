import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  if (searchParams.get('debug') === '1') {
    return NextResponse.json({
      NEXT_PUBLIC_META_CLIENT_ID: process.env.NEXT_PUBLIC_META_CLIENT_ID || 'Não definida',
      INSTAGRAM_APP_ID: process.env.INSTAGRAM_APP_ID || 'Não definida',
      NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL || 'Não definida',
      mensagem: "Redirecionamento travado com sucesso para análise."
    });
  }

  // ── Fluxo normal ──────────────────────────────────────────────────────────
  const state = crypto.randomUUID();
  const redirectUri = "https://autoscale-ia.vercel.app/api/instagram/callback";

  const oauthUrl =
    "https://api.instagram.com/oauth/authorize" +
    "?client_id=994894373212080" +
    "&redirect_uri=" + encodeURIComponent(redirectUri) +
    "&scope=instagram_business_basic,instagram_business_content_publish" +
    "&response_type=code" +
    "&state=" + state;

  console.log("[instagram/auth] client_id: 994894373212080");

  return new Response(null, {
    status: 302,
    headers: {
      Location: oauthUrl,
      "Set-Cookie": `ig_oauth_state=${state}; HttpOnly; Secure; SameSite=Lax; Max-Age=600; Path=/`,
    },
  });
}
