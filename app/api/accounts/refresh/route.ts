import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { fetch as undiciFetch } from "undici";

export const runtime = "nodejs";
export const maxDuration = 30;

const GRAPH = "https://graph.instagram.com/v21.0";

// OAuth / permission error codes → token is dead, mark account as error
// Apenas tokens genuinamente mortos: 190 = token inválido/expirado, 102/104 = session inválida.
// Permissão (200, 10, 368) e rate limit (4, 17) NÃO marcam como error permanente.
const TOKEN_ERROR_CODES = new Set([190, 102, 104]);

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

interface GraphStoriesEdge {
  data?: Array<{ id: string; timestamp?: string }>;
  error?: { message: string; code: number };
}

// Chamadas oficiais da Meta Graph API: conexão direta server-to-server
// (sem proxy residencial — ver decisão de arquitetura no CLAUDE.md).
// Timeout 12s por chamada — suficiente para a API da Meta responder normalmente
// e ainda cabe dentro do maxDuration=30 junto com as demais operações da rota.
async function fetchMeta(
  url: string,
): Promise<Response> {
  return await undiciFetch(url, { signal: AbortSignal.timeout(12_000) }) as unknown as Response;
}

async function fetchMetaProfile(
  igId: string,
  token: string,
): Promise<{ profile: GraphProfile; lastPostAt: string | null; activeStoriesCount: number; activeStoriesExpiringFirstAt: string | null }> {
  const profileUrl =
    `${GRAPH}/${igId}` +
    `?fields=followers_count,media_count,name,profile_picture_url,username` +
    `&access_token=${encodeURIComponent(token)}`;

  const profileRes = await fetchMeta(profileUrl);
  const profile = (await profileRes.json()) as GraphProfile;

  if (profile.error) return { profile, lastPostAt: null, activeStoriesCount: 0, activeStoriesExpiringFirstAt: null };

  // Fetch most recent media timestamp and active stories in parallel (both non-critical)
  let lastPostAt: string | null = null;
  let activeStoriesCount = 0;
  let activeStoriesExpiringFirstAt: string | null = null;

  await Promise.allSettled([
    // Last post timestamp
    (async () => {
      const mediaUrl =
        `${GRAPH}/${igId}/media` +
        `?fields=timestamp&limit=1` +
        `&access_token=${encodeURIComponent(token)}`;
      const mediaRes = await fetchMeta(mediaUrl);
      const mediaData = (await mediaRes.json()) as GraphMediaEdge;
      lastPostAt = mediaData.data?.[0]?.timestamp ?? null;
    })(),

    // Active stories count + earliest timestamp (mesmo request, campo extra —
    // permite atualizar o badge de stories na tela sem chamada adicional à Meta).
    (async () => {
      const storiesUrl =
        `${GRAPH}/${igId}/stories` +
        `?fields=id,timestamp` +
        `&access_token=${encodeURIComponent(token)}`;
      const storiesRes = await fetchMeta(storiesUrl);
      if (!storiesRes.ok) return;
      const storiesData = (await storiesRes.json()) as GraphStoriesEdge;
      if (!storiesData.error && Array.isArray(storiesData.data)) {
        activeStoriesCount = storiesData.data.length;
        const timestamps = storiesData.data.map((s) => s.timestamp).filter(Boolean) as string[];
        if (timestamps.length > 0) {
          activeStoriesExpiringFirstAt = timestamps.sort(
            (a, b) => new Date(a).getTime() - new Date(b).getTime()
          )[0];
        }
      }
    })(),
  ]);

  return { profile, lastPostAt, activeStoriesCount, activeStoriesExpiringFirstAt };
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

  let profileResult: Awaited<ReturnType<typeof fetchMetaProfile>>;
  try {
    profileResult = await fetchMetaProfile(igId, token);
  } catch (err) {
    const msg = (err as Error).message ?? String(err);
    console.warn(`[accounts/refresh] Meta não respondeu para @${(account as Record<string, unknown>).username}: ${msg.slice(0, 120)}`);
    return NextResponse.json(
      { error: "A Meta não respondeu agora — tente sincronizar novamente em instantes." },
      { status: 502 }
    );
  }
  const { profile, lastPostAt, activeStoriesCount, activeStoriesExpiringFirstAt } = profileResult;

  if (profile.error) {
    const code = profile.error.code;
    const errMsgLower = (profile.error.message ?? "").toLowerCase();
    // "Failed to decrypt" e similares são falhas de infraestrutura da Meta (transitórias).
    const isMetaInfra = code === 190 && (
      errMsgLower.includes("failed to decrypt") ||
      errMsgLower.includes("cannot parse access token") ||
      errMsgLower.includes("malformed access token")
    );
    const isTokenBad = TOKEN_ERROR_CODES.has(code) && !isMetaInfra;

    console.error(
      `[accounts/refresh] Meta API error for @${(account as Record<string, unknown>).username}: ` +
        `code=${code} — ${profile.error.message}`
    );

    if (isTokenBad) {
      await admin
        .from("instagram_accounts")
        .update({ health_status: "error" })
        .eq("id", accountId);
      // Grava no failover_logs para o diagnóstico mostrar o motivo real.
      // IMPORTANTE: deve ser awaited — promise fire-and-forget (void) solta depois
      // da response não tem garantia de terminar (restart do container, erro sem log).
      try {
        await (admin as any).from("failover_logs").insert({
          user_id: user.id,
          failed_account_id: accountId,
          backup_account_id: null,
          error_reason: `[refresh] code=${code} — ${profile.error?.message ?? ""}`,
        });
      } catch (logErr) {
        console.warn("[accounts/refresh] failover_log insert falhou:", (logErr as Error).message);
      }
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
    has_active_stories: activeStoriesCount > 0,
    active_stories_count: activeStoriesCount,
    active_stories_expiring_first_at: activeStoriesExpiringFirstAt,
    profile_refreshed_at: new Date().toISOString(),
    // NÃO sobrescrever health_status aqui:
    // health_status='error' pode ter sido definido pelo cron por erro de API
    // (ex: "Unsupported request - method type: post"), não por token inválido.
    // O refresh de perfil não deve desfazer essa marcação.
    // Para restaurar, use: Failover → Restaurar (manual).
  };
  if (lastPostAt) update.last_post_at = lastPostAt;
  if (profile.name) update.display_name = profile.name;
  if (profile.profile_picture_url) update.avatar_url = profile.profile_picture_url;

  // Try full update; if active_stories_count column doesn't exist yet, retry without it
  const { error: updateErr } = await admin
    .from("instagram_accounts")
    .update(update)
    .eq("id", accountId);

  if (updateErr) {
    if (updateErr.code === "42703" || updateErr.message?.includes("active_stories")) {
      // Column(s) not yet migrated — persist everything else
      const { active_stories_count: _c, active_stories_expiring_first_at: _e, ...updateWithoutCount } = update;
      await admin.from("instagram_accounts").update(updateWithoutCount).eq("id", accountId);
    } else {
      console.error("[accounts/refresh] Update error:", updateErr);
    }
  }

  return NextResponse.json({
    success: true,
    stats: update,
    active_stories_count: activeStoriesCount,
    active_stories_expiring_first_at: activeStoriesExpiringFirstAt,
  });
}
