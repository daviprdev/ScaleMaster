import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getSupabaseAdmin } from "@/lib/supabase";

export const dynamic = "force-dynamic";

const IG_API = "https://api.instagram.com";
const GRAPH_IG = "https://graph.instagram.com";

function redirectWithError(code: string, appUrl: string): NextResponse {
  const response = NextResponse.redirect(`${appUrl}/dashboard/accounts?error=${code}`);
  response.cookies.set("meta_oauth_state", "", { maxAge: 0, path: "/" });
  return response;
}

// Troca o authorization code por um Short-Lived Instagram User Token
async function exchangeCodeForShortToken(code: string, redirectUri: string): Promise<string> {
  const body = new URLSearchParams({
    client_id: process.env.NEXT_PUBLIC_META_CLIENT_ID!,
    client_secret: process.env.META_CLIENT_SECRET!,
    grant_type: "authorization_code",
    redirect_uri: redirectUri,
    code,
  });
  const res = await fetch(`${IG_API}/oauth/access_token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  const data = (await res.json()) as {
    access_token?: string;
    user_id?: number;
    error_type?: string;
    error_message?: string;
  };
  console.log("[meta/callback] exchangeCode status:", res.status, JSON.stringify(data).slice(0, 200));
  if (!res.ok || !data.access_token) {
    throw new Error(data.error_message ?? "Falha ao trocar authorization code por token.");
  }
  return data.access_token;
}

// Troca o Short-Lived Token por um Long-Lived Instagram User Token (~60 dias)
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
    token_type?: string;
    expires_in?: number;
    error?: { message: string };
  };
  console.log("[meta/callback] longLivedToken status:", res.status, JSON.stringify(data).slice(0, 200));
  if (!res.ok || !data.access_token) {
    throw new Error(data.error?.message ?? "Falha ao obter Long-Lived Token.");
  }
  const expiresIn = data.expires_in ?? 5_184_000; // 60 dias padrão
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
}

async function getIGProfile(longToken: string): Promise<IGProfile> {
  const params = new URLSearchParams({
    fields: "id,username,name,profile_picture_url",
    access_token: longToken,
  });
  const res = await fetch(`${GRAPH_IG}/me?${params}`);
  const data = (await res.json()) as IGProfile & { error?: { message: string } };
  console.log("[meta/callback] profile status:", res.status, JSON.stringify(data).slice(0, 200));
  if (!res.ok || !data.id) {
    throw new Error((data as { error?: { message: string } }).error?.message ?? "Falha ao obter perfil do Instagram.");
  }
  return data;
}

export async function GET(req: NextRequest) {
  const appUrl = (process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
  const redirectUri = `${appUrl}/api/meta/callback`;

  const { searchParams } = new URL(req.url);

  // Usuário cancelou a autorização
  if (searchParams.get("error")) {
    const desc = searchParams.get("error_description") ?? searchParams.get("error") ?? "cancelled";
    console.warn("[meta/callback] OAuth cancelado:", desc);
    return redirectWithError("cancelled", appUrl);
  }

  // Verificação CSRF
  const state = searchParams.get("state");
  const cookieState = req.cookies.get("meta_oauth_state")?.value;
  if (!state || !cookieState || state !== cookieState) {
    console.error("[meta/callback] State inválido — possível CSRF ou cookie expirado.");
    return redirectWithError("state_mismatch", appUrl);
  }

  const code = searchParams.get("code");
  if (!code) {
    return redirectWithError("no_code", appUrl);
  }

  // Verifica usuário autenticado no Supabase
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.redirect(`${appUrl}/auth/login`);
  }

  const admin = getSupabaseAdmin();

  try {
    const shortToken = await exchangeCodeForShortToken(code, redirectUri);
    console.log("[meta/callback] Short token obtido.");

    const { token: longToken, expiresAt } = await getLongLivedToken(shortToken);
    console.log("[meta/callback] Long-lived token obtido, expira em:", expiresAt.toISOString());

    const profile = await getIGProfile(longToken);
    console.log("[meta/callback] Perfil:", profile.username, "(id:", profile.id + ")");

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
      fb_page_id: null,
      token_expires_at: expiresAt.toISOString(),
      access_token: null,
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

    console.log(`[meta/callback] Conta @${profile.username} salva para user ${user.id}`);

    const response = NextResponse.redirect(`${appUrl}/dashboard/accounts?connected=1`);
    response.cookies.set("meta_oauth_state", "", { maxAge: 0, path: "/" });
    return response;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[meta/callback] Erro:", msg);
    return redirectWithError("server_error", appUrl);
  }
}
