import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { decrypt } from "@/lib/encrypt";
import { fetch as undiciFetch, type ProxyAgent } from "undici";
import { getProxyForAccount, proxyInit } from "@/lib/proxy";

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
  res.cookies.set("ig_oauth_magic_user_id", "", { maxAge: 0, path: "/" });
}

function redirectWithError(code: string, detail?: string, isMagicLink = false): NextResponse {
  const params = new URLSearchParams({ error: code });
  if (detail) params.set("detail", detail.slice(0, 500));
  const target = isMagicLink
    ? `${APP_URL}/add/error?reason=${code}`
    : `${APP_URL}/dashboard/accounts?${params}`;
  const res = NextResponse.redirect(target);
  clearOAuthCookies(res);
  return res;
}

function metaErrorDetail(
  fn: string,
  status: number,
  msg?: string,
  type?: string,
  code?: number
): string {
  const parts: string[] = [`[${fn}]`];
  if (type) parts.push(type);
  if (code !== undefined) parts.push(`(#${code}):`);
  parts.push(msg ? msg : `HTTP ${status}`);
  return parts.join(" ");
}

async function resolveCredentials(
  req: NextRequest,
  userId: string
): Promise<{ appId: string; appSecret: string; metaAppId: string | null } | null> {
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
    return { appId: app.ig_app_id, appSecret: secret, metaAppId: appCookieId };
  }

  const appId = process.env.NEXT_PUBLIC_META_CLIENT_ID ?? "";
  const appSecret = process.env.META_CLIENT_SECRET ?? "";
  if (!appId || !appSecret) return null;
  return { appId, appSecret, metaAppId: null };
}

// Wrapper de fetch com timeout e proxy opcional — usa undiciFetch para evitar caching do Next.js 15
async function fetchWithTimeout(
  url: string,
  options?: RequestInit,
  timeoutMs = FETCH_TIMEOUT_MS,
  proxy?: ProxyAgent | null
): Promise<Response> {
  try {
    return await undiciFetch(url, {
      ...options,
      signal: AbortSignal.timeout(timeoutMs),
      ...(proxy ? { dispatcher: proxy } : {}),
    } as any) as unknown as Response;
  } catch (err) {
    const name = (err as Error).name;
    if (name === "AbortError" || name === "TimeoutError") {
      throw new Error(`Timeout (${timeoutMs / 1000}s) ao contactar a Meta API. Tente novamente.`);
    }
    throw err;
  }
}

// Erro de rede do proxy (morto/instável) — a requisição nem chegou à Meta.
function isProxyNetworkError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message.toLowerCase() : String(err).toLowerCase();
  return msg.includes("fetch failed") || msg.includes("timeout");
}

// Executa a chamada à Meta com o proxy atual; se o proxy falhar com erro de rede,
// retenta sem proxy (IP Vercel — aceitável no onboarding, evento único de setup)
// e desativa o proxy para as chamadas seguintes do mesmo request.
async function callMetaWithFallback<T>(
  label: string,
  holder: { agent: ProxyAgent | null },
  fn: (proxy: ProxyAgent | null) => Promise<T>
): Promise<T> {
  try {
    return await fn(holder.agent);
  } catch (err) {
    if (!holder.agent || !isProxyNetworkError(err)) throw err;
    console.warn(
      `[ig/callback] ${label}: falha de rede via proxy (${(err as Error).message}) — retry sem proxy.`
    );
    holder.agent = null;
    return fn(null);
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

async function exchangeCode(
  code: string,
  appId: string,
  appSecret: string,
  proxy?: ProxyAgent | null
): Promise<{ token: string; igUserId: string }> {
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
  }, FETCH_TIMEOUT_MS, proxy);

  detectRateLimit(res);

  const data = (await res.json()) as {
    access_token?: string;
    user_id?: string | number;
    error_type?: string;
    error_message?: string;
    code?: number;
  };

  console.log("[ig/callback] exchangeCode →", res.status, JSON.stringify(data).slice(0, 400));

  const ecDetail = metaErrorDetail("exchangeCode", res.status, data.error_message, data.error_type, data.code);

  if (data.code === 4 || data.code === 17) {
    throw Object.assign(new Error(ecDetail), { isRateLimit: true });
  }

  const ecMsg = (data.error_message ?? "").toLowerCase();
  if (
    ecMsg.includes("permission") ||
    ecMsg.includes("business") ||
    ecMsg.includes("professional") ||
    ecMsg.includes("creator")
  ) {
    throw Object.assign(new Error(ecDetail), { isPersonalAccount: true });
  }

  if (!res.ok || !data.access_token) {
    throw new Error(ecDetail);
  }

  return { token: data.access_token, igUserId: String(data.user_id ?? "") };
}

async function getLongLivedToken(
  shortToken: string,
  appSecret: string,
  proxy?: ProxyAgent | null
): Promise<{ token: string; expiresAt: Date }> {
  const params = new URLSearchParams({
    grant_type: "ig_exchange_token",
    client_secret: appSecret,
    access_token: shortToken,
  });

  const res = await fetchWithTimeout(`${GRAPH_IG}/access_token?${params.toString()}`, undefined, FETCH_TIMEOUT_MS, proxy);

  detectRateLimit(res);

  const data = (await res.json()) as {
    access_token?: string;
    expires_in?: number;
    error?: { message: string; type?: string; code?: number; fbtrace_id?: string };
  };

  console.log("[ig/callback] longLivedToken →", res.status, JSON.stringify(data).slice(0, 400));

  const lltDetail = metaErrorDetail("getLongLivedToken", res.status, data.error?.message, data.error?.type, data.error?.code);

  // Meta retorna rate limit como HTTP 200 com error.code 4 ou 17
  if (data.error?.code === 4 || data.error?.code === 17 || data.error?.code === 32) {
    throw Object.assign(new Error(lltDetail), { isRateLimit: true });
  }

  if (!res.ok || !data.access_token) {
    throw new Error(lltDetail);
  }

  return {
    token: data.access_token,
    expiresAt: new Date(Date.now() + (data.expires_in ?? 5_184_000) * 1_000),
  };
}

async function getIGProfile(token: string, proxy?: ProxyAgent | null) {
  const res = await fetchWithTimeout(
    `${GRAPH_IG}/me?fields=id,username,name,profile_picture_url,media_count&access_token=${token}`,
    undefined,
    FETCH_TIMEOUT_MS,
    proxy
  );

  detectRateLimit(res);

  const data = (await res.json()) as {
    id?: string;
    username?: string;
    name?: string;
    profile_picture_url?: string;
    media_count?: number;
    error?: { message: string; type?: string; code?: number; fbtrace_id?: string };
  };

  console.log("[ig/callback] profile →", res.status, JSON.stringify(data).slice(0, 400));

  const profDetail = metaErrorDetail("getIGProfile", res.status, data.error?.message, data.error?.type, data.error?.code);

  if (data.error) {
    if (data.error.code === 4 || data.error.code === 17 || data.error.code === 32) {
      throw Object.assign(new Error(profDetail), { isRateLimit: true });
    }
    const profMsg = (data.error.message ?? "").toLowerCase();
    if (
      profMsg.includes("permission") ||
      profMsg.includes("business") ||
      profMsg.includes("professional") ||
      profMsg.includes("creator")
    ) {
      throw Object.assign(new Error(profDetail), { isPersonalAccount: true });
    }
    throw new Error(profDetail);
  }

  if (!res.ok || !data.id || !data.username) {
    throw new Error(profDetail);
  }

  return {
    id: data.id,
    username: data.username,
    name: data.name ?? null,
    profile_picture_url: data.profile_picture_url ?? null,
    media_count: data.media_count ?? null,
  };
}

async function upsertAccount(
  admin: ReturnType<typeof getSupabaseAdmin>,
  userId: string,
  profile: { id: string; username: string; name: string | null; profile_picture_url: string | null },
  longToken: string,
  expiresAt: Date,
  metaAppId: string | null
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
    meta_app_id: metaAppId,
    // Sempre reseta ao conectar/reconectar — o usuário forneceu um token novo,
    // então qualquer marcação de erro anterior não se aplica mais.
    health_status: "online",
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
        health_status: "online",
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

  // Magic link: user_id vem do cookie em vez de sessão autenticada.
  // Lido antes das checagens iniciais para que qualquer erro redirecione
  // para /add/error (o cliente do magic link não tem sessão no dashboard).
  const magicUserId = req.cookies.get("ig_oauth_magic_user_id")?.value ?? "";
  const isMagicLink = !!magicUserId;

  if (searchParams.get("error")) {
    const reason = searchParams.get("error_reason") ?? searchParams.get("error") ?? "";
    console.warn("[ig/callback] Cancelado pelo usuário:", reason);
    return redirectWithError("cancelled", undefined, isMagicLink);
  }

  const state = searchParams.get("state") ?? "";
  const cookieState = req.cookies.get("ig_oauth_state")?.value ?? "";
  if (!state || !cookieState || state !== cookieState) {
    console.error("[ig/callback] State inválido. state:", state, "| cookie:", cookieState);
    return redirectWithError("state_mismatch", undefined, isMagicLink);
  }

  const code = searchParams.get("code");
  if (!code) return redirectWithError("no_code", undefined, isMagicLink);

  let userId: string;
  if (isMagicLink) {
    userId = magicUserId;
  } else {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.redirect(`${APP_URL}/auth/login`);
    userId = user.id;
  }

  const credentials = await resolveCredentials(req, userId);
  if (!credentials) {
    console.error("[ig/callback] Credenciais do app não encontradas.");
    return redirectWithError("server_error", "Credenciais do app não encontradas. Tente novamente.", isMagicLink);
  }

  const admin = getSupabaseAdmin();

  // Busca um proxy bootstrap (qualquer conta do usuário com proxy configurado).
  // Isso roteia as chamadas de troca de token pela infra de proxy já em uso,
  // evitando que o IP da Vercel seja exposto à Meta durante o onboarding da conta.
  // Para usuários sem contas ainda (primeira conexão), cai no IP da Vercel —
  // aceitável pois é um evento único de setup, não recorrente de postagem.
  let bootstrapProxy: ProxyAgent | null = null;
  try {
    const { data: proxyAcct } = await (admin as any)
      .from("instagram_accounts")
      .select("id, proxy_url")
      .eq("user_id", userId)
      .not("proxy_url", "is", null)
      .limit(1)
      .maybeSingle();
    if (proxyAcct?.id && proxyAcct.proxy_url) {
      bootstrapProxy = getProxyForAccount(proxyAcct.id, proxyAcct.proxy_url);
      console.log(`[ig/callback] proxy bootstrap obtido de conta ${(proxyAcct.id as string).slice(0, 8)}…`);
    } else {
      console.log("[ig/callback] sem proxy bootstrap disponível — usando IP Vercel para exchange de token.");
    }
  } catch (e) {
    console.warn("[ig/callback] falha ao buscar proxy bootstrap:", (e as Error).message);
  }

  // Holder mutável: se um proxy falhar com erro de rede, callMetaWithFallback
  // zera o agent e as chamadas seguintes saem direto pelo IP da Vercel.
  const proxyHolder: { agent: ProxyAgent | null } = { agent: bootstrapProxy };

  try {
    const { token: shortToken, igUserId } = await callMetaWithFallback(
      "exchangeCode",
      proxyHolder,
      (p) => exchangeCode(code, credentials.appId, credentials.appSecret, p)
    );

    // Tenta obter o proxy específico da conta sendo (re)conectada.
    // Se o ig_user_id retornar e a conta já existir no banco com proxy próprio,
    // usamos esse proxy para as chamadas seguintes — mais preciso que o bootstrap.
    if (igUserId) {
      try {
        const { data: existingAcct } = await (admin as any)
          .from("instagram_accounts")
          .select("id, proxy_url")
          .eq("user_id", userId)
          .eq("ig_business_account_id", igUserId)
          .maybeSingle();
        if (existingAcct?.id && existingAcct.proxy_url) {
          const specificProxy = getProxyForAccount(existingAcct.id, existingAcct.proxy_url);
          if (specificProxy) {
            proxyHolder.agent = specificProxy;
            console.log(`[ig/callback] proxy específico da conta @ig_id=${igUserId} encontrado.`);
          }
        }
      } catch {
        // Mantém bootstrap proxy
      }
    }

    const { token: longToken, expiresAt } = await callMetaWithFallback(
      "getLongLivedToken",
      proxyHolder,
      (p) => getLongLivedToken(shortToken, credentials.appSecret, p)
    );
    const profile = await callMetaWithFallback(
      "getIGProfile",
      proxyHolder,
      (p) => getIGProfile(longToken, p)
    );

    console.log(`[ig/callback] @${profile.username} (id:${profile.id}) → user ${userId}${isMagicLink ? " [magic-link]" : ""}`);

    await upsertAccount(admin, userId, profile, longToken, expiresAt, credentials.metaAppId);

    if (profile.media_count !== null) {
      await admin
        .from("instagram_accounts")
        .update({ posts_count: profile.media_count })
        .eq("user_id", userId)
        .eq("ig_business_account_id", profile.id);
    }

    const successUrl = isMagicLink
      ? `${APP_URL}/add/success`
      : `${APP_URL}/dashboard/accounts?connected=1`;

    const response = NextResponse.redirect(successUrl);
    clearOAuthCookies(response);
    return response;

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const isPersonal = (err as { isPersonalAccount?: boolean }).isPersonalAccount === true;
    const isRateLimit = (err as { isRateLimit?: boolean }).isRateLimit === true;
    console.error("[ig/callback] Erro capturado:", msg);

    if (isRateLimit) return redirectWithError("rate_limit", msg, isMagicLink);
    if (isPersonal) return redirectWithError("personal_account", msg, isMagicLink);
    return redirectWithError("server_error", msg, isMagicLink);
  }
}
