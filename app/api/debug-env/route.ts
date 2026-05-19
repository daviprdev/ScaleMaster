import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

// Rota exclusiva de diagnóstico — nunca redireciona, só retorna JSON
export async function GET() {
  const clientId = process.env.NEXT_PUBLIC_META_CLIENT_ID ?? "(não definida)";
  const igAppId = process.env.NEXT_PUBLIC_INSTAGRAM_APP_ID ?? "(não definida)";
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "(não definida)";
  const redirectUri = "https://autoscale-ia.vercel.app/api/instagram/callback";
  const scope = "instagram_business_basic,instagram_business_content_publish";

  const oauthUrl =
    "https://api.instagram.com/oauth/authorize" +
    "?client_id=" + clientId +
    "&redirect_uri=" + encodeURIComponent(redirectUri) +
    "&scope=" + scope +
    "&response_type=code" +
    "&state=DEBUG";

  return NextResponse.json({
    buildTimestamp: new Date().toISOString(),
    env: {
      NEXT_PUBLIC_META_CLIENT_ID: clientId,
      NEXT_PUBLIC_INSTAGRAM_APP_ID: igAppId,
      NEXT_PUBLIC_APP_URL: appUrl,
      META_CLIENT_SECRET: process.env.META_CLIENT_SECRET ? "✓ definida" : "✗ ausente",
      INSTAGRAM_APP_SECRET: process.env.INSTAGRAM_APP_SECRET ? "✓ definida" : "✗ ausente",
    },
    oauthUrlQueSeriaGerada: oauthUrl,
  });
}
