import { NextRequest, NextResponse } from "next/server";
import { ApifyClient } from "apify-client";
import { createClient } from "@/lib/supabase/server";
import { getSupabaseAdmin } from "@/lib/supabase";

export const runtime = "nodejs";
export const maxDuration = 120;

const ACTOR_ID = "apify/instagram-scraper";

function isQuotaError(msg: string): boolean {
  const m = msg.toLowerCase();
  return (
    m.includes("limit exceeded") ||
    m.includes("usage") ||
    m.includes("quota") ||
    m.includes("rate limit") ||
    m.includes("429") ||
    m.includes("401") ||
    m.includes("403") ||
    m.includes("unauthorized") ||
    m.includes("authentication") ||
    m.includes("forbidden") ||
    m.includes("not found or authentication")
  );
}

interface ProfileStats {
  followersCount: number;
  postsCount: number;
  fullName: string;
  profilePicUrl: string | null;
  lastPostAt: string | null;
}

async function fetchProfileStats(token: string, username: string): Promise<ProfileStats> {
  const apify = new ApifyClient({ token });

  // resultsType "details" retorna campos do perfil: followersCount, postsCount, latestPosts, etc.
  const run = await apify.actor(ACTOR_ID).call({
    directUrls: [`https://www.instagram.com/${username}/`],
    resultsType: "details",
    maxRequestsPerCrawl: 5,
  });

  if (run.status !== "SUCCEEDED") {
    throw new Error(`Actor encerrou com status inesperado: ${run.status}`);
  }

  const { items } = await apify.dataset(run.defaultDatasetId).listItems();

  if (!Array.isArray(items) || items.length === 0) {
    throw new Error("Perfil não encontrado ou é privado.");
  }

  const p = items[0] as Record<string, unknown>;

  // Defensivo: checa múltiplos nomes de campo usados pelo actor em versões diferentes
  const followersCount = Number(
    p.followersCount ??
    p.followers_count ??
    (p.edgeFollowedBy as Record<string, unknown> | undefined)?.count ??
    0
  );
  const postsCount = Number(
    p.postsCount ??
    p.mediaCount ??
    p.media_count ??
    (p.edgeOwnerToTimelineMedia as Record<string, unknown> | undefined)?.count ??
    0
  );
  const fullName = String(p.fullName ?? p.full_name ?? username);
  const profilePicUrl = (
    p.profilePicUrl ??
    p.profile_pic_url ??
    p.profilePicUrlHD ??
    null
  ) as string | null;

  // Extrai timestamp do post mais recente do array latestPosts
  const latestPosts = Array.isArray(p.latestPosts) ? p.latestPosts : [];
  const firstPost = latestPosts[0] as Record<string, unknown> | undefined;
  const rawTs = firstPost
    ? (firstPost.timestamp ?? firstPost.taken_at_timestamp ?? firstPost.takenAt)
    : null;
  const lastPostAt = rawTs ? String(rawTs) : null;

  return { followersCount, postsCount, fullName, profilePicUrl, lastPostAt };
}

export async function POST(req: NextRequest) {
  const body = await req.json() as { accountId?: string };
  const { accountId } = body;

  if (!accountId) {
    return NextResponse.json({ error: "accountId é obrigatório." }, { status: 400 });
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });

  const admin = getSupabaseAdmin();
  const { data: account } = await admin
    .from("instagram_accounts")
    .select("id, username, user_id")
    .eq("id", accountId)
    .eq("user_id", user.id)
    .single();

  if (!account) {
    return NextResponse.json({ error: "Conta não encontrada." }, { status: 404 });
  }

  const tokens = [
    ...(process.env.APIFY_API_TOKENS?.split(",") ?? []),
    ...(process.env.APIFY_API_TOKEN?.split(",") ?? []),
  ].map((t) => t.trim()).filter(Boolean);

  const uniqueTokens = [...new Set(tokens)];

  if (uniqueTokens.length === 0) {
    return NextResponse.json(
      { error: "APIFY_API_TOKEN não configurado. Adicione a variável de ambiente e faça um novo deploy." },
      { status: 503 }
    );
  }

  let lastError = "Erro desconhecido";

  for (const token of uniqueTokens) {
    try {
      const stats = await fetchProfileStats(token, account.username);
      const now = new Date().toISOString();

      const update: Record<string, unknown> = {
        followers_count: stats.followersCount,
        posts_count: stats.postsCount,
        last_post_at: stats.lastPostAt,
        has_active_stories: null, // não suportado pelo actor atual
        profile_refreshed_at: now,
      };
      // Só sobrescreve nome/avatar se o actor retornou dados
      if (stats.fullName && stats.fullName !== account.username) {
        update.display_name = stats.fullName;
      }
      if (stats.profilePicUrl) {
        update.avatar_url = stats.profilePicUrl;
      }

      await admin.from("instagram_accounts").update(update).eq("id", accountId);
      return NextResponse.json({ success: true, stats: update });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (isQuotaError(msg)) {
        console.warn(`[accounts/refresh] Token ...${token.slice(-6)} esgotado: ${msg}`);
        lastError = msg;
        continue;
      }
      return NextResponse.json({ error: msg }, { status: 500 });
    }
  }

  return NextResponse.json(
    { error: `Todas as chaves Apify estão esgotadas. Último erro: ${lastError}` },
    { status: 503 }
  );
}
