import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const clientId = process.env.NEXT_PUBLIC_META_CLIENT_ID;

  if (!clientId) {
    return NextResponse.json(
      { error: "NEXT_PUBLIC_META_CLIENT_ID não configurada." },
      { status: 500 }
    );
  }

  const state = crypto.randomUUID();

  // redirect_uri deve estar registrada no Meta App → Casos de Uso → Login do Instagram
  const redirectUri = "https://autoscale-ia.vercel.app/api/instagram/callback";

  // Scope com vírgulas literais — NÃO usar URLSearchParams ou encodeURIComponent aqui
  const scope = "instagram_business_basic,instagram_business_content_publish";

  const oauthUrl =
    "https://api.instagram.com/oauth/authorize" +
    "?client_id=" + clientId +
    "&redirect_uri=" + encodeURIComponent(redirectUri) +
    "&scope=" + scope +
    "&response_type=code" +
    "&state=" + state;

  if (new URL(req.url).searchParams.get("debug") === "1") {
    return NextResponse.json({ oauthUrl, clientId, redirectUri, scope });
  }

  console.log("[instagram/auth] clientId:", clientId, "| redirectUri:", redirectUri);

  // Response nativa para não recodificar o Location header
  return new Response(null, {
    status: 302,
    headers: {
      Location: oauthUrl,
      "Set-Cookie": `ig_oauth_state=${state}; HttpOnly; Secure; SameSite=Lax; Max-Age=600; Path=/`,
    },
  });
}
