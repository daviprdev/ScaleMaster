import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { getAppUrl, getInstagramRedirectUri } from "@/lib/app-url";
import { signOAuthState } from "@/lib/oauth-cookie";
import { montarUrlOAuth } from "@/lib/meta-oauth-url";

export const dynamic = "force-dynamic";

const REDIRECT_URI = getInstagramRedirectUri();

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const appId = searchParams.get("appId");

  let clientId: string;
  let configId: string | null = null;

  if (appId) {
    // BYOC: load app credentials from DB
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    // request.url chega como 0.0.0.0:3000 no standalone da VPS.
    if (!user) return NextResponse.redirect(`${getAppUrl()}/auth/login`);

    const admin = getSupabaseAdmin();
    // select("*"): config_id pode não existir antes de supabase/user_meta_apps_unified.sql.
    const { data: app } = await admin
      .from("user_meta_apps")
      .select("*")
      .eq("id", appId)
      .eq("user_id", user.id)
      .single();

    if (!app?.ig_app_id) {
      return NextResponse.json({ error: "App não encontrado." }, { status: 404 });
    }

    clientId = app.ig_app_id;
    configId = app.config_id ?? null;
  } else {
    // Fallback: global env var
    clientId = process.env.NEXT_PUBLIC_META_CLIENT_ID ?? "";
    configId = process.env.META_CONFIG_ID || null;
    if (!clientId) {
      return NextResponse.json(
        { error: "Nenhum App configurado. Cadastre seu app em Meus Apps." },
        { status: 500 }
      );
    }
  }

  // Assinado e com prazo (lib/oauth-cookie.ts); o callback confere com o cookie.
  const state = signOAuthState();

  const oauthUrl = montarUrlOAuth({ clientId, configId, redirectUri: REDIRECT_URI, state });

  const response = NextResponse.redirect(oauthUrl);
  response.cookies.set("ig_oauth_state", state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 3600,
  });
  // Store which app was used so callback can decrypt the secret
  if (appId) {
    response.cookies.set("ig_oauth_app_id", appId, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 3600,
    });
  } else {
    // Clear any stale app cookie from previous BYOC flow
    response.cookies.set("ig_oauth_app_id", "", { maxAge: 0, path: "/" });
  }
  return response;
}
