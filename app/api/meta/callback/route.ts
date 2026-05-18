import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getSupabaseAdmin } from "@/lib/supabase";

export const dynamic = "force-dynamic";

const GRAPH_API = "https://graph.facebook.com/v19.0";

function redirectWithError(code: string, appUrl: string): NextResponse {
  const response = NextResponse.redirect(`${appUrl}/dashboard/accounts?error=${code}`);
  response.cookies.set("meta_oauth_state", "", { maxAge: 0, path: "/" });
  return response;
}

// Troca o code de autorização por um User Access Token de curta duração
async function exchangeCodeForShortToken(code: string, redirectUri: string): Promise<string> {
  // A Meta Graph API exige application/x-www-form-urlencoded neste endpoint — JSON não é aceito
  const body = new URLSearchParams({
    client_id: process.env.NEXT_PUBLIC_META_CLIENT_ID!,
    client_secret: process.env.META_CLIENT_SECRET!,
    redirect_uri: redirectUri,
    code,
  });
  const res = await fetch(`${GRAPH_API}/oauth/access_token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  const data = (await res.json()) as {
    access_token?: string;
    error?: { message: string; type: string };
  };
  console.log("[meta/callback] exchangeCodeForShortToken status:", res.status, JSON.stringify(data).slice(0, 200));
  if (!res.ok || !data.access_token) {
    throw new Error(data.error?.message ?? "Falha ao trocar authorization code por token.");
  }
  return data.access_token;
}

// Troca o token curto por um Long-Lived User Access Token (~60 dias)
async function getLongLivedToken(
  shortToken: string
): Promise<{ token: string; expiresAt: Date }> {
  const params = new URLSearchParams({
    grant_type: "fb_exchange_token",
    client_id: process.env.NEXT_PUBLIC_META_CLIENT_ID!,
    client_secret: process.env.META_CLIENT_SECRET!,
    fb_exchange_token: shortToken,
  });
  const res = await fetch(`${GRAPH_API}/oauth/access_token?${params}`);
  const data = (await res.json()) as {
    access_token?: string;
    expires_in?: number;
    error?: { message: string };
  };
  if (!res.ok || !data.access_token) {
    throw new Error(data.error?.message ?? "Falha ao obter Long-Lived Token.");
  }
  const expiresIn = data.expires_in ?? 5_184_000; // 60 dias como padrão
  return {
    token: data.access_token,
    expiresAt: new Date(Date.now() + expiresIn * 1_000),
  };
}

interface IGAccountData {
  fbPageId: string;
  igBusinessAccountId: string;
  igUsername: string;
  igName: string | null;
  igProfilePicture: string | null;
}

// Consulta /me/accounts para listar Páginas FB e IDs de contas IG Business vinculadas
async function getLinkedIGAccounts(longToken: string): Promise<IGAccountData[]> {
  const fields =
    "id,name,access_token,instagram_business_account{id,username,name,profile_picture_url}";
  const res = await fetch(
    `${GRAPH_API}/me/accounts?fields=${encodeURIComponent(fields)}&access_token=${longToken}`
  );
  const data = (await res.json()) as {
    data?: Array<{
      id: string;
      name: string;
      access_token: string;
      instagram_business_account?: {
        id: string;
        username: string;
        name: string;
        profile_picture_url?: string;
      };
    }>;
    error?: { message: string };
  };

  if (!res.ok) {
    throw new Error(data.error?.message ?? "Falha ao listar Páginas do Facebook.");
  }

  return (data.data ?? [])
    .filter((page) => !!page.instagram_business_account)
    .map((page) => ({
      fbPageId: page.id,
      igBusinessAccountId: page.instagram_business_account!.id,
      igUsername: page.instagram_business_account!.username,
      igName: page.instagram_business_account!.name ?? null,
      igProfilePicture: page.instagram_business_account!.profile_picture_url ?? null,
    }));
}

export async function GET(req: NextRequest) {
  const appUrl = (process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
  const redirectUri = `${appUrl}/api/meta/callback`;

  const { searchParams } = new URL(req.url);

  // Usuário cancelou o diálogo de autorização do Facebook
  if (searchParams.get("error")) {
    const desc = searchParams.get("error_description") ?? searchParams.get("error") ?? "cancelled";
    console.warn("[meta/callback] OAuth cancelado:", desc);
    return redirectWithError("cancelled", appUrl);
  }

  // Verificação de state para prevenção de CSRF
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

  // Verifica autenticação do usuário no Supabase
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
    console.log("[meta/callback] Short token obtido, trocando por long-lived token...");

    const { token: longToken, expiresAt } = await getLongLivedToken(shortToken);
    console.log("[meta/callback] Long-lived token obtido, expira em:", expiresAt.toISOString());

    const igAccounts = await getLinkedIGAccounts(longToken);
    console.log(`[meta/callback] Contas IG encontradas: ${igAccounts.length}`, igAccounts.map(a => a.igUsername));

    if (igAccounts.length === 0) {
      return redirectWithError("no_ig_accounts", appUrl);
    }

    // Salva cada conta IG Business/Creator no banco (insert ou update por user_id+username)
    for (const acc of igAccounts) {
      const { data: existing } = await admin
        .from("instagram_accounts")
        .select("id")
        .eq("user_id", user.id)
        .eq("username", acc.igUsername)
        .maybeSingle();

      const payload = {
        display_name: acc.igName,
        avatar_url: acc.igProfilePicture,
        is_active: true,
        meta_access_token: longToken,
        ig_business_account_id: acc.igBusinessAccountId,
        fb_page_id: acc.fbPageId,
        token_expires_at: expiresAt.toISOString(),
        // Limpa o token legado do instagrapi ao conectar via Meta
        access_token: null,
      };

      if (existing) {
        await admin.from("instagram_accounts").update(payload).eq("id", existing.id);
      } else {
        await admin.from("instagram_accounts").insert({
          user_id: user.id,
          username: acc.igUsername,
          connected_at: new Date().toISOString(),
          ...payload,
        });
      }
    }

    console.log(
      `[meta/callback] ${igAccounts.length} conta(s) salvas para user ${user.id}: ` +
        igAccounts.map((a) => a.igUsername).join(", ")
    );

    const response = NextResponse.redirect(
      `${appUrl}/dashboard/accounts?connected=${igAccounts.length}`
    );
    response.cookies.set("meta_oauth_state", "", { maxAge: 0, path: "/" });
    return response;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[meta/callback] Erro:", msg);
    return redirectWithError("server_error", appUrl);
  }
}
