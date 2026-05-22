import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { decrypt } from "@/lib/encrypt";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

const REDIRECT_URI = "https://autoscale-ia.vercel.app/api/instagram/callback";
const GRAPH_IG = "https://graph.instagram.com";
const FETCH_TIMEOUT_MS = 15_000;

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
    const admin = getSupabaseAdmin();
    const { data: app, error } = await admin
      .from("user_meta_apps")
      .select("ig_app_id, ig_app_secret")
      .eq("id", appCookieId)
      .eq("user_id", userId)
      .single();

    if (error || !app) {
      console.error("[ig/callback] resolveCredentials: falha ao buscar BYOC →", error?.message ?? "not found");
      return null;
    }

    let secret: string;
    try {
      secret = decrypt(app.ig_app_secret);
    } catch (e) {
      console.error("[ig/callback] resolveCredentials: falha ao decriptar secret →", (e as Error).message);
      return null;
    }
    return { appId: app.ig_app_id, appSecret: secret };
  }

  const appId = process.env.NEXT_PUBLIC_INSTAGRAM_APP_ID ?? "";
  const appSecret = process.env.INSTAGRAM_APP_SECRET ?? "";
  if (!appId || !appSecret) return null;
  return { appId, appSecret };
}

// Wrapper de fetch com AbortController para prevenir hangs
async function fetchWithTimeout(
  url: string,
  options?: RequestInit,
  timeoutMs = FETCH_TIMEOUT_MS
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch (err) {
    const name = (err as Error).name;
    if (name === "AbortError" || name === "TimeoutError") {
      throw new Error(`Timeout (${timeoutMs / 1000}s) ao contactar a Meta API. Tente novamente.`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

function detectRateLimit(res: Response): void {
  if (res.status === 429) {
    const retryAfter = res.headers.get("Retry-After") ?? "60";
    throw Object.assign(
      new Error(`Rate limit da Meta API atingido. Aguarde ${retryAfter}s antes de tentar novamente.`),
      { isRateLimit: true }
    );
  }
}

async function exchangeCode(code: string, appId: string, appSecret: string): Promise<string> {
  const body = new URLSearchParams({
    client_id: appId,
    client_secret: appSecret,
    grant_type: "authorization_code",
    redirect_uri: REDIRECT_URI,
    code,
  });

  const res = await fetchWithTimeout("https://api.instagram.com/oauth/access_token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });

  detectRateLimit(res);

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
    throw new Error(`[exchangeCode] ${data.error_message ?? `HTTP ${res.status}`}`);
  }

  return data.access_token;
}

async function getLongLivedToken(
  shortToken: string,
  appSecret: string
): Promise<{ token: string; expiresAt: Date }> {
  const body = new URLSearchParams({
    grant_type: "ig_exchange_token",
    client_secret: appSecret,
    access_token: shortToken,
  });

  // Instagram Login API requer POST para troca de long-lived token
  const res = await fetchWithTimeout(`${GRAPH_IG}/access_token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });

  detectRateLimit(res);

  const data = (await res.json()) as {
    access_token?: string;
    expires_in?: number;
    error?: { message: string; code?: number };
  };

  console.log("[ig/callback] longLivedToken →", res.status, JSON.stringify(data).slice(0, 200));

  if (!res.ok || !data.access_token) {
    throw new Error(`[getLongLivedToken] ${data.error?.message ?? `HTTP ${res.status}`}`);
  }

  return {
    token: data.access_token,
    expiresAt: new Date(Date.now() + (data.expires_in ?? 5_184_000) * 1_000),
  };
}

async function getIGProfile(token: string) {
  const res = await fetchWithTimeout(
    `${GRAPH_IG}/me?fields=id,username,name,profile_picture_url&access_token=${token}`
  );

  detectRateLimit(res);

  const data = (await res.json()) as {
    id?: string;
    username?: string;
    name?: string;
    profile_picture_url?: string;
    error?: { message: string; type?: string; code?: number };
  };

  console.log("[ig/callback] profile →", res.status, JSON.stringify(data).slice(0, 200));

  if (data.error?.type === "OAuthException") {
    throw Object.assign(
      new Error("Sua conta precisa ser Comercial ou de Criador de Conteúdo no Instagram."),
      { isPersonalAccount: true }
    );
  }

  if (!res.ok || !data.id || !data.username) {
    throw new Error(`[getIGProfile] ${data.error?.message ?? `HTTP ${res.status}`}`);
  }

  return {
    id: data.id,
    username: data.username,
    name: data.name ?? null,
    profile_picture_url: data.profile_picture_url ?? null,
  };
}

async function upsertAccount(
  admin: ReturnType<typeof getSupabaseAdmin>,
  userId: string,
  profile: { id: string; username: string; name: string | null; profile_picture_url: string | null },
  longToken: string,
  expiresAt: Date
): Promise<void> {
  const now = new Date().toISOString();
  const payload = {
    user_id: userId,
    username: profile.username,
    display_name: profile.name,
    avatar_url: profile.profile_picture_url,
    is_active: true,
    meta_access_token: longToken,
    ig_business_account_id: profile.id,
    token_expires_at: expiresAt.toISOString(),
    access_token: null,
    fb_page_id: null,
    connected_at: now,
  };

  // Tenta UPSERT pela chave composta (user_id, ig_business_account_id)
  const { error: upsertError } = await admin
    .from("instagram_accounts")
    .upsert(payload, { onConflict: "user_id,ig_business_account_id", ignoreDuplicates: false });

  if (!upsertError) return;

  // Se o UPSERT falhou por ausência de unique constraint, cai no fallback manual
  const isMissingConstraint =
    upsertError.code === "42P10" ||
    upsertError.message.includes("there is no unique or exclusion constraint");

  if (!isMissingConstraint) {
    throw new Error(`[supabase/upsert] ${upsertError.message} (code: ${upsertError.code})`);
  }

  console.warn("[ig/callback] upsertAccount: sem unique constraint em (user_id, ig_business_account_id) — usando fallback SELECT+UPDATE/INSERT");

  const { data: existing, error: selectError } = await admin
    .from("instagram_accounts")
    .select("id")
    .eq("user_id", userId)
    .eq("username", profile.username)
    .maybeSingle();

  if (selectError) {
    throw new Error(`[supabase/select] ${selectError.message}`);
  }

  if (existing) {
    const { error: updateError } = await admin
      .from("instagram_accounts")
      .update({
        display_name: profile.name,
        avatar_url: profile.profile_picture_url,
        is_active: true,
        meta_access_token: longToken,
        ig_business_account_id: profile.id,
        token_expires_at: expiresAt.toISOString(),
        access_token: null,
        fb_page_id: null,
      })
      .eq("id", existing.id);

    if (updateError) throw new Error(`[supabase/update] ${updateError.message}`);
  } else {
    const { error: insertError } = await admin
      .from("instagram_accounts")
      .insert(payload);

    if (insertError) throw new Error(`[supabase/insert] ${insertError.message}`);
  }
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);

  if (searchParams.get("error")) {
    const reason = searchParams.get("error_reason") ?? searchParams.get("error") ?? "";
    console.warn("[ig/callback] Cancelado pelo usuário:", reason);
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
    console.error("[ig/callback] Credenciais do app não encontradas.");
    return redirectWithError("server_error", "Credenciais do app não encontradas. Tente novamente.");
  }

  const admin = getSupabaseAdmin();

  try {
    const shortToken = await exchangeCode(code, credentials.appId, credentials.appSecret);
    const { token: longToken, expiresAt } = await getLongLivedToken(shortToken, credentials.appSecret);
    const profile = await getIGProfile(longToken);

    console.log(`[ig/callback] @${profile.username} (id:${profile.id}) → user ${user.id}`);

    await upsertAccount(admin, user.id, profile, longToken, expiresAt);

    const response = NextResponse.redirect(`${APP_URL}/dashboard/accounts?connected=1`);
    clearOAuthCookies(response);
    return response;

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const isPersonal = (err as { isPersonalAccount?: boolean }).isPersonalAccount === true;
    const isRateLimit = (err as { isRateLimit?: boolean }).isRateLimit === true;
    console.error("[ig/callback] Erro capturado:", msg);

    if (isRateLimit) return redirectWithError("rate_limit", msg);
    if (isPersonal) return redirectWithError("personal_account", msg);
    return redirectWithError("server_error", msg);
  }
}
