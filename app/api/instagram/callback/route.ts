import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { getMetaApp, getMetaApps } from "@/lib/meta-apps";

export const dynamic = "force-dynamic";

const GRAPH = "https://graph.facebook.com/v19.0";

function redirectWithError(code: string, appUrl: string, detail?: string): NextResponse {
  const params = new URLSearchParams({ error: code });
  if (detail) params.set("detail", detail.slice(0, 150));
  const res = NextResponse.redirect(`${appUrl}/dashboard/accounts?${params}`);
  res.cookies.set("ig_oauth_state", "", { maxAge: 0, path: "/" });
  return res;
}

async function exchangeCodeForToken(
  code: string,
  redirectUri: string,
  clientId: string,
  clientSecret: string
): Promise<string> {
  const body = new URLSearchParams({ client_id: clientId, client_secret: clientSecret, redirect_uri: redirectUri, code });
  const res = await fetch(`${GRAPH}/oauth/access_token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  const data = (await res.json()) as { access_token?: string; error?: { message: string } };
  console.log("[ig/callback] exchangeCode →", res.status, JSON.stringify(data).slice(0, 200));
  if (!res.ok || !data.access_token) throw new Error(data.error?.message ?? `Falha ao trocar código (HTTP ${res.status}).`);
  return data.access_token;
}

async function getLongLivedToken(
  shortToken: string,
  clientId: string,
  clientSecret: string
): Promise<{ token: string; expiresAt: Date }> {
  const params = new URLSearchParams({ grant_type: "fb_exchange_token", client_id: clientId, client_secret: clientSecret, fb_exchange_token: shortToken });
  const res = await fetch(`https://graph.facebook.com/oauth/access_token?${params}`);
  const data = (await res.json()) as { access_token?: string; expires_in?: number; error?: { message: string } };
  console.log("[ig/callback] longLivedToken →", res.status, JSON.stringify(data).slice(0, 200));
  if (!res.ok || !data.access_token) throw new Error(data.error?.message ?? "Falha ao obter Long-Lived Token.");
  return { token: data.access_token, expiresAt: new Date(Date.now() + (data.expires_in ?? 5_184_000) * 1_000) };
}

async function getIGProfile(longToken: string) {
  const params = new URLSearchParams({
    fields: "id,name,instagram_business_account{id,username,name,profile_picture_url}",
    access_token: longToken,
  });
  const res = await fetch(`${GRAPH}/me/accounts?${params}`);
  const data = (await res.json()) as {
    data?: { id: string; name: string; instagram_business_account?: { id: string; username?: string; name?: string; profile_picture_url?: string } }[];
    error?: { message: string };
  };
  console.log("[ig/callback] accounts →", res.status, JSON.stringify(data).slice(0, 400));
  if (!res.ok || !data.data) throw new Error(data.error?.message ?? "Falha ao listar Páginas do Facebook.");

  for (const page of data.data) {
    if (page.instagram_business_account) {
      const ig = page.instagram_business_account;
      return { id: ig.id, username: ig.username ?? page.name, name: ig.name ?? page.name, profile_picture_url: ig.profile_picture_url ?? null, fb_page_id: page.id };
    }
  }
  throw new Error("Nenhuma conta do Instagram Business conectada às suas Páginas do Facebook. Vincule a conta em facebook.com → Sua Página → Configurações → Instagram.");
}

export async function GET(req: NextRequest) {
  const appUrl = (process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
  const redirectUri = `${appUrl}/api/instagram/callback`;
  const { searchParams } = new URL(req.url);

  if (searchParams.get("error")) {
    console.warn("[ig/callback] Cancelado:", searchParams.get("error_reason") ?? searchParams.get("error"));
    return redirectWithError("cancelled", appUrl);
  }

  // Verificação CSRF
  const state = searchParams.get("state") ?? "";
  const cookieState = req.cookies.get("ig_oauth_state")?.value ?? "";
  if (!state || !cookieState || state !== cookieState) {
    console.error("[ig/callback] State inválido. state:", state, "| cookie:", cookieState);
    return redirectWithError("state_mismatch", appUrl);
  }

  // Extrai app_id do state (formato "app1:uuid") — fallback para primeiro app
  const colonIdx = state.indexOf(":");
  const appId = colonIdx > 0 ? state.substring(0, colonIdx) : null;
  const app = (appId ? getMetaApp(appId) : null) ?? getMetaApps()[0] ?? null;
  if (!app) {
    console.error("[ig/callback] App não encontrado:", appId);
    return redirectWithError("invalid_app", appUrl);
  }

  const code = searchParams.get("code");
  if (!code) return redirectWithError("no_code", appUrl);

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.redirect(`${appUrl}/auth/login`);

  const admin = getSupabaseAdmin();

  try {
    const shortToken = await exchangeCodeForToken(code, redirectUri, app.clientId, app.clientSecret);
    const { token: longToken, expiresAt } = await getLongLivedToken(shortToken, app.clientId, app.clientSecret);
    const profile = await getIGProfile(longToken);

    console.log(`[ig/callback] @${profile.username} | ig_id:${profile.id} | page:${profile.fb_page_id} | app:${app.id}`);

    const { data: existing } = await admin.from("instagram_accounts").select("id").eq("user_id", user.id).eq("username", profile.username).maybeSingle();

    const payload = {
      display_name: profile.name ?? profile.username,
      avatar_url: profile.profile_picture_url,
      is_active: true,
      meta_access_token: longToken,
      ig_business_account_id: profile.id,
      fb_page_id: profile.fb_page_id,
      token_expires_at: expiresAt.toISOString(),
      access_token: null,
      meta_app_used: app.id,
    } as unknown as Record<string, unknown>;

    if (existing) {
      await admin.from("instagram_accounts").update(payload).eq("id", existing.id);
    } else {
      await admin.from("instagram_accounts").insert({ user_id: user.id, username: profile.username, connected_at: new Date().toISOString(), ...payload });
    }

    const response = NextResponse.redirect(`${appUrl}/dashboard/accounts?connected=1`);
    response.cookies.set("ig_oauth_state", "", { maxAge: 0, path: "/" });
    return response;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[ig/callback] Erro:", msg);
    return redirectWithError("server_error", appUrl, msg);
  }
}
