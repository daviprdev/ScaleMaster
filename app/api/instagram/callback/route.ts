import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { decrypt } from "@/lib/encrypt";

export const dynamic = "force-dynamic";

const REDIRECT_URI = "https://autoscale-ia.vercel.app/api/instagram/callback";
const GRAPH_IG = "https://graph.instagram.com";

const APP_URL =
  (process.env.NEXT_PUBLIC_APP_URL ?? "https://autoscale-ia.vercel.app").replace(/\/$/, "");

function clearOAuthCookies(res: NextResponse) {
  res.cookies.set("ig_oauth_state", "", { maxAge: 0, path: "/" });
  res.cookies.set("ig_oauth_app_id", "", { maxAge: 0, path: "/" });
}

function redirectWithError(code: string, detail?: string): NextResponse {
  const params = new URLSearchParams({ error: code });
  if (detail) params.set("detail", detail.slice(0, 200));
  const res = NextResponse.redirect(`${APP_URL}/dashboard/accounts?${params}`);
  clearOAuthCookies(res);
  return res;
}

async function resolveCredentials(
  req: NextRequest,
  userId: string
): Promise<{ appId: string; appSecret: string } | null> {
  const appCookieId = req.cookies.get("ig_oauth_app_id")?.value ?? "";

  if (appCookieId) {
    // BYOC: look up from user_meta_apps
    const admin = getSupabaseAdmin();
    const { data: app } = await admin
      .from("user_meta_apps")
      .select("ig_app_id, ig_app_secret")
      .eq("id", appCookieId)
      .eq("user_id", userId)
      .single();

    if (!app) return null;

    let secret: string;
    try {
      secret = decrypt(app.ig_app_secret);
    } catch {
      return null;
    }
    return { appId: app.ig_app_id, appSecret: secret };
  }

  // Fallback: global env vars
  const appId = process.env.NEXT_PUBLIC_INSTAGRAM_APP_ID ?? "";
  const appSecret = process.env.INSTAGRAM_APP_SECRET ?? "";
  if (!appId || !appSecret) return null;
  return { appId, appSecret };
}

async function exchangeCode(code: string, appId: string, appSecret: string): Promise<string> {
  const body = new URLSearchParams({
    client_id: appId,
    client_secret: appSecret,
    grant_type: "authorization_code",
    redirect_uri: REDIRECT_URI,
    code,
  });

  const res = await fetch("https://api.instagram.com/oauth/access_token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });

  const data = (await res.json()) as {
    access_token?: string;
    error_type?: string;
    error_message?: string;
    code?: number;
  };

  console.log("[ig/callback] exchangeCode →", res.status, JSON.stringify(data).slice(0, 300));

  if (
    data.error_type ||
    (data.code && data.code >= 10) ||
    String(data.error_message ?? "").toLowerCase().includes("permission") ||
    String(data.error_message ?? "").toLowerCase().includes("business") ||
    String(data.error_message ?? "").toLowerCase().includes("professional")
  ) {
    throw Object.assign(
      new Error("Sua conta precisa ser Comercial ou de Criador de Conteúdo no Instagram."),
      { isPersonalAccount: true }
    );
  }

  if (!res.ok || !data.access_token) {
    throw new Error(data.error_message ?? `Falha na troca do código (HTTP ${res.status}).`);
  }

  return data.access_token;
}

async function getLongLivedToken(
  shortToken: string,
  appSecret: string
): Promise<{ token: string; expiresAt: Date }> {
  const params = new URLSearchParams({
    grant_type: "ig_exchange_token",
    client_secret: appSecret,
    access_token: shortToken,
  });

  const res = await fetch(`${GRAPH_IG}/access_token?${params}`);
  const data = (await res.json()) as {
    access_token?: string;
    expires_in?: number;
    error?: { message: string };
  };

  console.log("[ig/callback] longLivedToken →", res.status, JSON.stringify(data).slice(0, 200));

  if (!res.ok || !data.access_token) {
    throw new Error(data.error?.message ?? `Falha ao obter Long-Lived Token (HTTP ${res.status}).`);
  }

  return {
    token: data.access_token,
    expiresAt: new Date(Date.now() + (data.expires_in ?? 5_184_000) * 1_000),
  };
}

async function getIGProfile(token: string) {
  const res = await fetch(
    `${GRAPH_IG}/me?fields=id,username,name,profile_picture_url&access_token=${token}`
  );
  const data = (await res.json()) as {
    id?: string;
    username?: string;
    name?: string;
    profile_picture_url?: string;
    error?: { message: string; type?: string };
  };

  console.log("[ig/callback] profile →", res.status, JSON.stringify(data).slice(0, 200));

  if (data.error?.type === "OAuthException") {
    throw Object.assign(
      new Error("Sua conta precisa ser Comercial ou de Criador de Conteúdo no Instagram."),
      { isPersonalAccount: true }
    );
  }

  if (!res.ok || !data.id || !data.username) {
    throw new Error(data.error?.message ?? `Falha ao buscar perfil (HTTP ${res.status}).`);
  }

  return {
    id: data.id,
    username: data.username,
    name: data.name ?? null,
    profile_picture_url: data.profile_picture_url ?? null,
  };
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);

  if (searchParams.get("error")) {
    const reason = searchParams.get("error_reason") ?? searchParams.get("error") ?? "";
    console.warn("[ig/callback] Cancelado:", reason);
    return redirectWithError("cancelled");
  }

  const state = searchParams.get("state") ?? "";
  const cookieState = req.cookies.get("ig_oauth_state")?.value ?? "";
  if (!state || !cookieState || state !== cookieState) {
    console.error("[ig/callback] State inválido. state:", state, "| cookie:", cookieState);
    return redirectWithError("state_mismatch");
  }

  const code = searchParams.get("code");
  if (!code) return redirectWithError("no_code");

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.redirect(`${APP_URL}/auth/login`);

  const credentials = await resolveCredentials(req, user.id);
  if (!credentials) {
    console.error("[ig/callback] Credenciais não encontradas para o fluxo OAuth.");
    return redirectWithError("server_error", "Credenciais do app não encontradas. Tente novamente.");
  }

  const admin = getSupabaseAdmin();

  try {
    const shortToken = await exchangeCode(code, credentials.appId, credentials.appSecret);
    const { token: longToken, expiresAt } = await getLongLivedToken(shortToken, credentials.appSecret);
    const profile = await getIGProfile(longToken);

    console.log(`[ig/callback] @${profile.username} (id:${profile.id}) → user ${user.id}`);

    const { data: existing } = await admin
      .from("instagram_accounts")
      .select("id")
      .eq("user_id", user.id)
      .eq("username", profile.username)
      .maybeSingle();

    const payload = {
      display_name: profile.name,
      avatar_url: profile.profile_picture_url,
      is_active: true,
      meta_access_token: longToken,
      ig_business_account_id: profile.id,
      token_expires_at: expiresAt.toISOString(),
      access_token: null,
      fb_page_id: null,
    };

    if (existing) {
      await admin.from("instagram_accounts").update(payload).eq("id", existing.id);
    } else {
      await admin.from("instagram_accounts").insert({
        user_id: user.id,
        username: profile.username,
        connected_at: new Date().toISOString(),
        ...payload,
      });
    }

    const response = NextResponse.redirect(`${APP_URL}/dashboard/accounts?connected=1`);
    clearOAuthCookies(response);
    return response;

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const isPersonal = (err as { isPersonalAccount?: boolean }).isPersonalAccount === true;
    console.error("[ig/callback] Erro:", msg);
    return isPersonal
      ? redirectWithError("personal_account", msg)
      : redirectWithError("server_error", msg);
  }
}
