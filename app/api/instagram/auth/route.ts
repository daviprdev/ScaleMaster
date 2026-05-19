import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  // Instagram App ID — NUNCA usar o Facebook App ID aqui
  const clientId = process.env.NEXT_PUBLIC_INSTAGRAM_APP_ID;

  if (!clientId) {
    return NextResponse.json(
      { error: "NEXT_PUBLIC_INSTAGRAM_APP_ID não está definida. Adicione na Vercel e faça redeploy." },
      { status: 500 }
    );
  }

  const state = crypto.randomUUID();

  const redirectUri = "https://autoscale-ia.vercel.app/api/instagram/callback";

  // Scope com vírgulas LITERAIS — não passar por nenhuma função de encoding
  const scope = "instagram_business_basic,instagram_business_content_publish";

  // URL montada como string pura — sem URLSearchParams, sem encodeURIComponent no scope
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

  console.log("[instagram/auth] client_id:", clientId);
  console.log("[instagram/auth] oauthUrl:", oauthUrl);

  // Usar Response nativa para garantir que o Location header NÃO seja recodificado
  const res = new Response(null, {
    status: 302,
    headers: {
      Location: oauthUrl,
      "Set-Cookie": `ig_oauth_state=${state}; HttpOnly; Secure; SameSite=Lax; Max-Age=600; Path=/`,
    },
  });

  return res;
}
