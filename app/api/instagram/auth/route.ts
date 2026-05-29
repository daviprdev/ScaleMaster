import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { createClient } from "@/lib/supabase/server";
import { getSupabaseAdmin } from "@/lib/supabase";

export const dynamic = "force-dynamic";

const REDIRECT_URI = "https://autoscale-ia.vercel.app/api/instagram/callback";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const appId = searchParams.get("appId");

  let clientId: string;

  if (appId) {
    // BYOC: load app credentials from DB
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.redirect(new URL("/auth/login", request.url));

    const admin = getSupabaseAdmin();
    const { data: app } = await admin
      .from("user_meta_apps")
      .select("ig_app_id")
      .eq("id", appId)
      .eq("user_id", user.id)
      .single();

    if (!app?.ig_app_id) {
      return NextResponse.json({ error: "App não encontrado." }, { status: 404 });
    }

    clientId = app.ig_app_id;
  } else {
    // Fallback: global env var
    clientId = process.env.NEXT_PUBLIC_META_CLIENT_ID ?? "";
    if (!clientId) {
      return NextResponse.json(
        { error: "Nenhum App configurado. Cadastre seu app em Meus Apps." },
        { status: 500 }
      );
    }
  }

  const state = crypto.randomUUID();

  const oauthUrl =
    "https://api.instagram.com/oauth/authorize" +
    "?client_id=" + clientId +
    "&redirect_uri=" + encodeURIComponent(REDIRECT_URI) +
    "&scope=instagram_business_basic,instagram_business_content_publish,instagram_business_manage_comments" +
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
