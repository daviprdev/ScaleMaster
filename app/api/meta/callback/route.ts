import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { getMetaApp } from "@/lib/meta-apps";

export const dynamic = "force-dynamic";

const GRAPH = "https://graph.facebook.com/v19.0";

function redirectWithError(code: string, appUrl: string): NextResponse {
  const response = NextResponse.redirect(`${appUrl}/dashboard/accounts?error=${code}`);
  response.cookies.set("meta_oauth_state", "", { maxAge: 0, path: "/" });
  return response;
}

// Troca o authorization code por um User Access Token (Facebook Graph API)
async function exchangeCodeForToken(
  code: string,
  redirectUri: string,
  clientId: string,
  clientSecret: string
): Promise<string> {
  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: redirectUri,
    code,
  });
  const res = await fetch(`${GRAPH}/oauth/access_token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  const data = (await res.json()) as {
    access_token?: string;
    error?: { message: string };
  };
  console.log("[meta/callback] exchangeCode status:", res.status, JSON.stringify(data).slice(0, 200));
  if (!res.ok || !data.access_token) {
    throw new Error(data.error?.message ?? "Falha ao trocar authorization code por token.");
  }
  return data.access_token;
}

// Troca o Short-Lived Token por um Long-Lived Token (~60 dias) via Facebook
async function getLongLivedToken(
  shortToken: string,
  clientId: string,
  clientSecret: string
): Promise<{ token: string; expiresAt: Date }> {
  const params = new URLSearchParams({
    grant_type: "fb_exchange_token",
    client_id: clientId,
    client_secret: clientSecret,
    fb_exchange_token: shortToken,
  });
  const res = await fetch(`https://graph.facebook.com/oauth/access_token?${params}`);
  const data = (await res.json()) as {
    access_token?: string;
    expires_in?: number;
    error?: { message: string };
  };
  console.log("[meta/callback] longLivedToken status:", res.status, JSON.stringify(data).slice(0, 200));
  if (!res.ok || !data.access_token) {
    throw new Error(data.error?.message ?? "Falha ao obter Long-Lived Token.");
  }
  const expiresIn = data.expires_in ?? 5_184_000;
  return {
    token: data.access_token,
    expiresAt: new Date(Date.now() + expiresIn * 1_000),
  };
}

interface IGProfile {
  id: string;
  username: string;
  name?: string;
  profile_picture_url?: string;
  fb_page_id: string;
}

// Busca as Páginas do Facebook e retorna a primeira com Instagram Business conectado
async function getIGProfile(longToken: string): Promise<IGProfile> {
  const params = new URLSearchParams({
    fields: "id,name,instagram_business_account{id,username,name,profile_picture_url}",
    access_token: longToken,
  });
  const res = await fetch(`${GRAPH}/me/accounts?${params}`);
  const data = (await res.json()) as {
    data?: {
      id: string;
      name: string;
      instagram_business_account?: {
        id: string;
        username?: string;
        name?: string;
        profile_picture_url?: string;
      };
    }[];
    error?: { message: string };
  };
  console.log("[meta/callback] accounts status:", res.status, JSON.stringify(data).slice(0, 400));

  if (!res.ok || !data.data) {
    throw new Error(data.error?.message ?? "Falha ao obter Páginas do Facebook.");
  }

  for (const page of data.data) {
    if (page.instagram_business_account) {
      const ig = page.instagram_business_account;
      return {
        id: ig.id,
        username: ig.username ?? page.name,
        name: ig.name ?? page.name,
        profile_picture_url: ig.profile_picture_url ?? undefined,
        fb_page_id: page.id,
      };
    }
  }

  throw new Error(
    "Nenhuma conta do Instagram Business está conectada às suas Páginas do Facebook. " +
    "Acesse as configurações do Facebook e vincule sua conta do Instagram."
  );
}

export async function GET(req: NextRequest) {
  const appUrl = (process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
  const redirectUri = `${appUrl}/api/meta/callback`;

  const { searchParams } = new URL(req.url);

  if (searchParams.get("error")) {
    const desc = searchParams.get("error_description") ?? searchParams.get("error") ?? "cancelled";
    console.warn("[meta/callback] OAuth cancelado:", desc);
    return redirectWithError("cancelled", appUrl);
  }

  const state = searchParams.get("state");
  const cookieState = req.cookies.get("meta_oauth_state")?.value;
  if (!state || !cookieState || state !== cookieState) {
    console.error("[meta/callback] State inválido — possível CSRF ou cookie expirado.");
    return redirectWithError("state_mismatch", appUrl);
  }

  const colonIdx = state.indexOf(":");
  const appId = colonIdx > 0 ? state.substring(0, colonIdx) : state;
  const app = getMetaApp(appId);
  if (!app) {
    console.error("[meta/callback] App não encontrado:", appId);
    return redirectWithError("invalid_app", appUrl);
  }

  const code = searchParams.get("code");
  if (!code) {
    return redirectWithError("no_code", appUrl);
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.redirect(`${appUrl}/auth/login`);
  }

  const admin = getSupabaseAdmin();

  try {
    const shortToken = await exchangeCodeForToken(code, redirectUri, app.clientId, app.clientSecret);
    console.log("[meta/callback] Short token obtido via", app.id);

    const { token: longToken, expiresAt } = await getLongLivedToken(shortToken, app.clientId, app.clientSecret);
    console.log("[meta/callback] Long-lived token obtido, expira em:", expiresAt.toISOString());

    const profile = await getIGProfile(longToken);
    console.log("[meta/callback] Perfil:", profile.username, "(ig_id:", profile.id, "| page_id:", profile.fb_page_id + ")", "app:", app.id);

    const { data: existing } = await admin
      .from("instagram_accounts")
      .select("id")
      .eq("user_id", user.id)
      .eq("username", profile.username)
      .maybeSingle();

    const payload = {
      display_name: profile.name ?? profile.username,
      avatar_url: profile.profile_picture_url ?? null,
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
      await admin.from("instagram_accounts").insert({
        user_id: user.id,
        username: profile.username,
        connected_at: new Date().toISOString(),
        ...payload,
      });
    }

    console.log(`[meta/callback] Conta @${profile.username} salva via ${app.id} para user ${user.id}`);

    const response = NextResponse.redirect(`${appUrl}/dashboard/accounts?connected=1`);
    response.cookies.set("meta_oauth_state", "", { maxAge: 0, path: "/" });
    return response;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[meta/callback] Erro:", msg);
    // Redireciona com a mensagem de erro para exibir na UI
    const errParam = encodeURIComponent(msg.slice(0, 120));
    const response = NextResponse.redirect(`${appUrl}/dashboard/accounts?error=server_error&detail=${errParam}`);
    response.cookies.set("meta_oauth_state", "", { maxAge: 0, path: "/" });
    return response;
  }
}
