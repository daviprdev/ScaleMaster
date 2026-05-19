import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  // ── DEBUG: deve ser a PRIMEIRA coisa — retorna JSON puro, sem redirect ──
  if (req.nextUrl.searchParams.get("debug") === "1") {
    return NextResponse.json({
      NEXT_PUBLIC_META_CLIENT_ID: process.env.NEXT_PUBLIC_META_CLIENT_ID ?? "(não definida)",
      NEXT_PUBLIC_INSTAGRAM_APP_ID: process.env.NEXT_PUBLIC_INSTAGRAM_APP_ID ?? "(não definida)",
      INSTAGRAM_APP_SECRET: process.env.INSTAGRAM_APP_SECRET ? "(definida)" : "(não definida)",
      META_CLIENT_SECRET: process.env.META_CLIENT_SECRET ? "(definida)" : "(não definida)",
      NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL ?? "(não definida)",
      urlQueSeriaGerada:
        "https://api.instagram.com/oauth/authorize" +
        "?client_id=" + (process.env.NEXT_PUBLIC_META_CLIENT_ID ?? "AUSENTE") +
        "&redirect_uri=" + encodeURIComponent("https://autoscale-ia.vercel.app/api/instagram/callback") +
        "&scope=instagram_business_basic,instagram_business_content_publish" +
        "&response_type=code" +
        "&state=DEBUG_STATE",
    });
  }

  // ── Fluxo normal ──────────────────────────────────────────────────────────
  const clientId = process.env.NEXT_PUBLIC_META_CLIENT_ID;

  if (!clientId) {
    return NextResponse.json(
      { error: "NEXT_PUBLIC_META_CLIENT_ID não configurada." },
      { status: 500 }
    );
  }

  const state = crypto.randomUUID();
  const redirectUri = "https://autoscale-ia.vercel.app/api/instagram/callback";
  const scope = "instagram_business_basic,instagram_business_content_publish";

  const oauthUrl =
    "https://api.instagram.com/oauth/authorize" +
    "?client_id=" + clientId +
    "&redirect_uri=" + encodeURIComponent(redirectUri) +
    "&scope=" + scope +
    "&response_type=code" +
    "&state=" + state;

  console.log("[instagram/auth] clientId:", clientId);

  return new Response(null, {
    status: 302,
    headers: {
      Location: oauthUrl,
      "Set-Cookie": `ig_oauth_state=${state}; HttpOnly; Secure; SameSite=Lax; Max-Age=600; Path=/`,
    },
  });
}
