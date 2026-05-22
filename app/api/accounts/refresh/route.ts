import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getSupabaseAdmin } from "@/lib/supabase";

export const runtime = "nodejs";
export const maxDuration = 30;

const GRAPH = "https://graph.instagram.com/v21.0";

// OAuth / permission error codes → token is dead, mark account as error
const TOKEN_ERROR_CODES = new Set([190, 102, 104, 200, 10, 4, 368]);

interface GraphProfile {
  id?: string;
  name?: string;
  username?: string;
  followers_count?: number;
  media_count?: number;
  profile_picture_url?: string;
  error?: { message: string; type: string; code: number };
}

interface GraphMediaEdge {
  data?: Array<{ id: string; timestamp: string }>;
  error?: { message: string; code: number };
}

async function fetchMetaProfile(
  igId: string,
  token: string
): Promise<{ profile: GraphProfile; lastPostAt: string | null }> {
  const profileUrl =
    `${GRAPH}/${igId}` +
    `?fields=followers_count,media_count,name,profile_picture_url,username` +
    `&access_token=${encodeURIComponent(token)}`;

  const profileRes = await fetch(profileUrl, { cache: "no-store" });
  const profile = (await profileRes.json()) as GraphProfile;

  if (profile.error) return { profile, lastPostAt: null };

  // Fetch most recent media timestamp (non-critical)
  let lastPostAt: string | null = null;
  try {
    const mediaUrl =
      `${GRAPH}/${igId}/media` +
      `?fields=timestamp&limit=1` +
      `&access_token=${encodeURIComponent(token)}`;
    const mediaRes = await fetch(mediaUrl, { cache: "no-store" });
    const mediaData = (await mediaRes.json()) as GraphMediaEdge;
    lastPostAt = mediaData.data?.[0]?.timestamp ?? null;
  } catch {
    // non-critical
  }

  return { profile, lastPostAt };
}

export async function POST(req: NextRequest) {
  const body = (await req.json()) as { accountId?: string };
  const { accountId } = body;

  if (!accountId) {
    return NextResponse.json({ error: "accountId é obrigatório." }, { status: 400 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });

  const admin = getSupabaseAdmin();
  const { data: account } = await admin
    .from("instagram_accounts")
    .select("id, username, user_id, ig_business_account_id, meta_access_token")
    .eq("id", accountId)
    .eq("user_id", user.id)
    .single();

  if (!account) {
    return NextResponse.json({ error: "Conta não encontrada." }, { status: 404 });
  }

  const igId = (account as Record<string, unknown>).ig_business_account_id as string | null;
  const token = (account as Record<string, unknown>).meta_access_token as string | null;

  if (!igId || !token) {
    return NextResponse.json(
      { error: "Conta sem credenciais Meta. Reconecte via OAuth." },
      { status: 422 }
    );
  }

  const { profile, lastPostAt } = await fetchMetaProfile(igId, token);

  if (profile.error) {
    const code = profile.error.code;
    const isTokenBad = TOKEN_ERROR_CODES.has(code);

    console.error(
      `[accounts/refresh] Meta API error for @${(account as Record<string, unknown>).username}: ` +
        `code=${code} — ${profile.error.message}`
    );

    if (isTokenBad) {
      await admin
        .from("instagram_accounts")
        .update({ health_status: "error" })
        .eq("id", accountId);
    }

    return NextResponse.json(
      {
        error: profile.error.message,
        meta_code: code,
        health_status: isTokenBad ? "error" : "online",
      },
      { status: 400 }
    );
  }

  const update: Record<string, unknown> = {
    followers_count: profile.followers_count ?? 0,
    posts_count: profile.media_count ?? 0,
    profile_refreshed_at: new Date().toISOString(),
    health_status: "online",
  };
  if (lastPostAt) update.last_post_at = lastPostAt;
  if (profile.name) update.display_name = profile.name;
  if (profile.profile_picture_url) update.avatar_url = profile.profile_picture_url;

  await admin.from("instagram_accounts").update(update).eq("id", accountId);

  return NextResponse.json({ success: true, stats: update });
}
