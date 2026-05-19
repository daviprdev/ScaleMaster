import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getSupabaseAdmin } from "@/lib/supabase";

export const dynamic = "force-dynamic";

const IG_APP_ID = process.env.NEXT_PUBLIC_INSTAGRAM_APP_ID ?? "";
const IG_APP_SECRET = process.env.INSTAGRAM_APP_SECRET ?? "";

const REDIRECT_URI = "https://autoscale-ia.vercel.app/api/instagram/callback";
const GRAPH_IG = "https://graph.instagram.com";

const APP_URL =
  (process.env.NEXT_PUBLIC_APP_URL ?? "https://autoscale-ia.vercel.app").replace(/\/$/, "");

function redirectWithError(code: string, detail?: string): NextResponse {
  const params = new URLSearchParams({ error: code });
  if (detail) params.set("detail", detail.slice(0, 200));
  const res = NextResponse.redirect(`${APP_URL}/dashboard/accounts?${params}`);
  res.cookies.set("ig_oauth_state", "", { maxAge: 0, path: "/" });
  return res;
}

// Troca o authorization code por um short-lived token
async function exchangeCode(code: string): Promise<string> {
  const body = new URLSearchParams({
    client_id: IG_APP_ID,
    client_secret: IG_APP_SECRET,
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

  // Conta pessoal: Instagram retorna código de permissão negada
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

// Troca o short-lived token por um Long-Lived Token (~60 dias)
async function getLongLivedToken(shortToken: string): Promise<{ token: string; expiresAt: Date }> {
  const params = new URLSearchParams({
    grant_type: "ig_exchange_token",
    client_secret: IG_APP_SECRET,
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

// Busca perfil do Instagram autenticado
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

  // Conta pessoal detectada via tipo de erro
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

  // Cancelado pelo usuário
  if (searchParams.get("error")) {
    const reason = searchParams.get("error_reason") ?? searchParams.get("error") ?? "";
    console.warn("[ig/callback] Cancelado:", reason);
    return redirectWithError("cancelled");
  }

  // Verificação CSRF
  const state = searchParams.get("state") ?? "";
  const cookieState = req.cookies.get("ig_oauth_state")?.value ?? "";
  if (!state || !cookieState || state !== cookieState) {
    console.error("[ig/callback] State inválido. state:", state, "| cookie:", cookieState);
    return redirectWithError("state_mismatch");
  }

  const code = searchParams.get("code");
  if (!code) return redirectWithError("no_code");

  // Sessão Supabase
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.redirect(`${APP_URL}/auth/login`);

  const admin = getSupabaseAdmin();

  try {
    const shortToken = await exchangeCode(code);
    const { token: longToken, expiresAt } = await getLongLivedToken(shortToken);
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
    response.cookies.set("ig_oauth_state", "", { maxAge: 0, path: "/" });
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
