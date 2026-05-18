import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const GRAPH_API = "https://graph.facebook.com/v19.0";

interface IGAccount {
  fbPageId: string;
  igBusinessAccountId: string;
  igUsername: string;
  igName: string | null;
  igProfilePicture: string | null;
}

// Tenta trocar por long-lived token; se já for long-lived (ou falhar), usa o token original
async function tryGetLongLivedToken(token: string): Promise<{ token: string; expiresAt: Date }> {
  const params = new URLSearchParams({
    grant_type: "fb_exchange_token",
    client_id: process.env.NEXT_PUBLIC_META_CLIENT_ID!,
    client_secret: process.env.META_CLIENT_SECRET!,
    fb_exchange_token: token,
  });
  const res = await fetch(`${GRAPH_API}/oauth/access_token?${params}`);
  const data = (await res.json()) as { access_token?: string; expires_in?: number };
  if (res.ok && data.access_token) {
    const expiresIn = data.expires_in ?? 5_184_000;
    return { token: data.access_token, expiresAt: new Date(Date.now() + expiresIn * 1_000) };
  }
  // Token já pode ser long-lived (gerado pelo Graph API Explorer com essa opção)
  return { token, expiresAt: new Date(Date.now() + 5_184_000 * 1_000) };
}

async function findIGAccounts(token: string): Promise<IGAccount[]> {
  // Tentativa 1: /me/accounts → Páginas FB com IG Business vinculado
  const fields = "id,name,instagram_business_account{id,username,name,profile_picture_url}";
  const res = await fetch(
    `${GRAPH_API}/me/accounts?fields=${encodeURIComponent(fields)}&access_token=${token}`
  );
  const data = (await res.json()) as {
    data?: Array<{
      id: string;
      instagram_business_account?: {
        id: string; username: string; name?: string; profile_picture_url?: string;
      };
    }>;
  };

  const fromPages: IGAccount[] = (data.data ?? [])
    .filter((p) => !!p.instagram_business_account)
    .map((p) => ({
      fbPageId: p.id,
      igBusinessAccountId: p.instagram_business_account!.id,
      igUsername: p.instagram_business_account!.username,
      igName: p.instagram_business_account!.name ?? null,
      igProfilePicture: p.instagram_business_account!.profile_picture_url ?? null,
    }));

  if (fromPages.length > 0) return fromPages;

  // Tentativa 2: token de usuário com IG diretamente (perfis Creator)
  const fallback = await fetch(
    `${GRAPH_API}/me?fields=instagram_business_account{id,username,name,profile_picture_url}&access_token=${token}`
  );
  const fb = (await fallback.json()) as {
    instagram_business_account?: {
      id: string; username: string; name?: string; profile_picture_url?: string;
    };
  };
  const ig = fb.instagram_business_account;
  if (ig?.id && ig?.username) {
    return [{
      fbPageId: "",
      igBusinessAccountId: ig.id,
      igUsername: ig.username,
      igName: ig.name ?? null,
      igProfilePicture: ig.profile_picture_url ?? null,
    }];
  }

  return [];
}

export async function POST(req: NextRequest) {
  const body = (await req.json()) as { access_token?: string };
  const rawToken = body.access_token?.trim();

  if (!rawToken) {
    return NextResponse.json({ error: "Access token não informado." }, { status: 400 });
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });

  const { token, expiresAt } = await tryGetLongLivedToken(rawToken);
  const igAccounts = await findIGAccounts(token);

  if (igAccounts.length === 0) {
    return NextResponse.json(
      {
        error:
          "Nenhuma conta Instagram Business ou Creator encontrada para este token. " +
          "Verifique se selecionou as permissões corretas no Graph API Explorer: " +
          "instagram_basic, instagram_content_publish, pages_show_list.",
      },
      { status: 404 }
    );
  }

  const admin = getSupabaseAdmin();
  const saved: string[] = [];

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
      meta_access_token: token,
      ig_business_account_id: acc.igBusinessAccountId,
      fb_page_id: acc.fbPageId || null,
      token_expires_at: expiresAt.toISOString(),
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
    saved.push(acc.igUsername);
  }

  console.log(`[meta/connect-token] ${saved.length} conta(s) salvas para user ${user.id}:`, saved);
  return NextResponse.json({ success: true, connected: saved.length, usernames: saved });
}
