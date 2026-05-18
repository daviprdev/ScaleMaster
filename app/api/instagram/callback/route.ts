import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getSupabaseAdmin } from "@/lib/supabase";

export const dynamic = "force-dynamic";

const IG_TOKEN_URL = "https://api.instagram.com/oauth/access_token";
const GRAPH_IG = "https://graph.instagram.com";

const OAUTH_ERROR_LABELS: Record<string, string> = {
  cancelled: "cancelled",
  state_mismatch: "state_mismatch",
  no_code: "no_code",
  server_error: "server_error",
};

function redirectWithError(code: keyof typeof OAUTH_ERROR_LABELS, appUrl: string): NextResponse {
  const res = NextResponse.redirect(`${appUrl}/dashboard/accounts?error=${code}`);
  res.cookies.set("ig_oauth_state", "", { maxAge: 0, path: "/" });
  return res;
}

// Troca o authorization code por um short-lived Instagram User Access Token
async function exchangeCode(
  code: string,
  redirectUri: string
): Promise<{ accessToken: string }> {
  const body = new URLSearchParams({
    client_id: process.env.NEXT_PUBLIC_META_CLIENT_ID!,
    client_secret: process.env.META_CLIENT_SECRET!,
    grant_type: "authorization_code",
    redirect_uri: redirectUri,
    code,
  });

  const res = await fetch(IG_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });

  const data = (await res.json()) as {
    access_token?: string;
    user_id?: number | string;
    error_type?: string;
    error_message?: string;
  };

  console.log(
    "[ig/callback] exchangeCode →",
    res.status,
    JSON.stringify(data).slice(0, 200)
  );

  if (!res.ok || !data.access_token) {
    throw new Error(
      data.error_message ?? `Falha na troca do código (HTTP ${res.status}).`
    );
  }

  return { accessToken: data.access_token };
}

// Troca o short-lived token por um Long-Lived Token (~60 dias)
async function getLongLivedToken(
  shortToken: string
): Promise<{ token: string; expiresAt: Date }> {
  const params = new URLSearchParams({
    grant_type: "ig_exchange_token",
    client_secret: process.env.META_CLIENT_SECRET!,
    access_token: shortToken,
  });

  const res = await fetch(`${GRAPH_IG}/access_token?${params}`);
  const data = (await res.json()) as {
    access_token?: string;
    expires_in?: number;
    error?: { message: string };
  };

  console.log(
    "[ig/callback] getLongLivedToken →",
    res.status,
    JSON.stringify(data).slice(0, 200)
  );

  if (!res.ok || !data.access_token) {
    throw new Error(
      data.error?.message ?? `Falha ao obter long-lived token (HTTP ${res.status}).`
    );
  }

  const expiresIn = data.expires_in ?? 5_184_000;
  return {
    token: data.access_token,
    expiresAt: new Date(Date.now() + expiresIn * 1_000),
  };
}

// Busca id, username e dados do perfil da conta Instagram autenticada
async function getIGProfile(token: string): Promise<{
  id: string;
  username: string;
  name: string | null;
  profilePicture: string | null;
}> {
  const res = await fetch(
    `${GRAPH_IG}/me?fields=id,username,name,profile_picture_url&access_token=${token}`
  );
  const data = (await res.json()) as {
    id?: string;
    username?: string;
    name?: string;
    profile_picture_url?: string;
    error?: { message: string };
  };

  console.log(
    "[ig/callback] getIGProfile →",
    res.status,
    JSON.stringify(data).slice(0, 200)
  );

  if (!res.ok || !data.id || !data.username) {
    throw new Error(
      data.error?.message ?? `Falha ao buscar perfil do Instagram (HTTP ${res.status}).`
    );
  }

  return {
    id: data.id,
    username: data.username,
    name: data.name ?? null,
    profilePicture: data.profile_picture_url ?? null,
  };
}

export async function GET(req: NextRequest) {
  const appUrl = (process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
  const redirectUri = `${appUrl}/api/instagram/callback`;
  const { searchParams } = new URL(req.url);

  // Usuário cancelou na tela do Instagram
  if (searchParams.get("error")) {
    console.warn("[ig/callback] Cancelado:", searchParams.get("error_reason"));
    return redirectWithError("cancelled", appUrl);
  }

  // Verificação CSRF via state
  const state = searchParams.get("state");
  const cookieState = req.cookies.get("ig_oauth_state")?.value;
  if (!state || !cookieState || state !== cookieState) {
    console.error("[ig/callback] State inválido — possível CSRF ou cookie expirado.");
    return redirectWithError("state_mismatch", appUrl);
  }

  const code = searchParams.get("code");
  if (!code) return redirectWithError("no_code", appUrl);

  // Verifica sessão do usuário no SaaS (necessário para associar a conta ao user_id)
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.redirect(`${appUrl}/auth/login`);

  try {
    const { accessToken: shortToken } = await exchangeCode(code, redirectUri);
    const { token: longToken, expiresAt } = await getLongLivedToken(shortToken);
    const profile = await getIGProfile(longToken);

    console.log(
      `[ig/callback] Conta obtida: @${profile.username} (id: ${profile.id}) para user ${user.id}`
    );

    // Usa admin client (bypassa RLS) para escrita; leitura no frontend usa browser client com RLS
    const admin = getSupabaseAdmin();

    const { data: existing } = await admin
      .from("instagram_accounts")
      .select("id")
      .eq("user_id", user.id)
      .eq("username", profile.username)
      .maybeSingle();

    const payload = {
      display_name: profile.name,
      avatar_url: profile.profilePicture,
      is_active: true,
      meta_access_token: longToken,
      ig_business_account_id: profile.id,
      token_expires_at: expiresAt.toISOString(),
      access_token: null,
      fb_page_id: null,
    };

    if (existing) {
      await admin.from("instagram_accounts").update(payload).eq("id", existing.id);
      console.log(`[ig/callback] Conta @${profile.username} atualizada.`);
    } else {
      await admin.from("instagram_accounts").insert({
        user_id: user.id,
        username: profile.username,
        connected_at: new Date().toISOString(),
        ...payload,
      });
      console.log(`[ig/callback] Conta @${profile.username} inserida.`);
    }

    const response = NextResponse.redirect(
      `${appUrl}/dashboard/accounts?connected=1`
    );
    response.cookies.set("ig_oauth_state", "", { maxAge: 0, path: "/" });
    return response;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[ig/callback] Erro:", msg);
    return redirectWithError("server_error", appUrl);
  }
}
