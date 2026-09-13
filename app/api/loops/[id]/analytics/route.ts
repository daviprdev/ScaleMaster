import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { fetchAllRows } from "@/lib/video-history";
import { fetchPostInsights, insightsUpdatePayload } from "@/lib/meta-insights";

export const runtime = "nodejs";
export const maxDuration = 30;
export const dynamic = "force-dynamic";

const INSIGHTS_CACHE_MS = 30 * 60_000; // refresca a cada 30 min

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ContainerRow {
  id: string;
  account_id: string;
  status: string;
  media_id: string | null;
  error_message: string | null;
  insights_likes: number | null;
  insights_comments: number | null;
  insights_plays: number | null;
  insights_reach: number | null;
  insights_fetched_at: string | null;
  created_at: string;
  instagram_accounts: {
    id: string;
    username: string;
    avatar_url: string | null;
    followers_count: number | null;
    meta_access_token: string | null;
  } | null;
}


// ---------------------------------------------------------------------------
// Handler principal
// ---------------------------------------------------------------------------

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: loopId } = await params;

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });

  const admin = getSupabaseAdmin();

  // Carrega dados do loop
  const { data: loop } = await (admin as any)
    .from("loops")
    .select("id, name, folder_id, account_folder_id, cycles_done, media_limit, created_at, user_id")
    .eq("id", loopId)
    .eq("user_id", user.id)
    .single();

  if (!loop) return NextResponse.json({ error: "Loop não encontrado." }, { status: 404 });

  // Conta vídeos na pasta (respeitando media_limit)
  let videosInFolder = 0;
  if (loop.folder_id) {
    let q = (admin as any)
      .from("videos_library")
      .select("id", { count: "exact", head: true })
      .eq("folder_id", loop.folder_id);
    if (loop.media_limit) q = q.limit(loop.media_limit);
    const { count } = await q;
    videosInFolder = count ?? 0;
  }

  // Conta contas vinculadas ao loop.
  // Modo pasta (account_folder_id): busca dinamicamente de instagram_accounts.
  // Modo específico: conta de loop_accounts (tabela estática N:N).
  let accountCount: number;
  if (loop.account_folder_id) {
    const { count } = await (admin as any)
      .from("instagram_accounts")
      .select("id", { count: "exact", head: true })
      .eq("folder_id", loop.account_folder_id)
      .eq("user_id", user.id)
      .eq("is_active", true)
      .neq("health_status", "error");
    accountCount = count ?? 0;
  } else {
    const { count } = await (admin as any)
      .from("loop_accounts")
      .select("account_id", { count: "exact", head: true })
      .eq("loop_id", loopId);
    accountCount = count ?? 0;
  }

  const totalTarget = videosInFolder * Math.max(1, accountCount);

  // Todos os containers deste loop com info das contas
  // Paginado: `.limit(100000)` não bypassa o teto de 1000 linhas do PostgREST —
  // um loop antigo com mais de 1000 containers teria as métricas truncadas.
  let containers: unknown[] = [];
  try {
    containers = await fetchAllRows((from, to) =>
      (admin as any)
        .from("pending_containers")
        .select(`
          id, account_id, status, media_id, error_message,
          insights_likes, insights_comments, insights_plays, insights_reach,
          insights_fetched_at, created_at,
          instagram_accounts (
            id, username, avatar_url, followers_count, meta_access_token
          )
        `)
        .eq("loop_id", loopId)
        .order("created_at", { ascending: false })
        .range(from, to)
    );
  } catch (e) {
    console.error(`[loops/analytics] falha ao paginar containers: ${(e as Error).message}`);
  }

  const rows = (containers ?? []) as ContainerRow[];
  const now = Date.now();

  // Atualiza insights dos containers publicados com dados faltando ou expirados
  const needsInsights = rows.filter(r =>
    r.status === "published" &&
    r.media_id &&
    r.media_id !== "" &&
    r.instagram_accounts?.meta_access_token &&
    (!r.insights_fetched_at ||
      now - new Date(r.insights_fetched_at).getTime() > INSIGHTS_CACHE_MS)
  );

  if (needsInsights.length > 0) {
    // Máx 10 por chamada para não estourar maxDuration
    const batch = needsInsights.slice(0, 10);
    await Promise.allSettled(
      batch.map(async (c) => {
        const ins = await fetchPostInsights(
          c.media_id!,
          c.instagram_accounts!.meta_access_token!,
          "reel"
        );
        // Só grava o que a Meta devolveu: antes, falha virava 0 por cima das
        // views reais já salvas.
        const payload = insightsUpdatePayload(ins);
        await (admin as any)
          .from("pending_containers")
          .update(payload)
          .eq("id", c.id);
        // Patch em memória para retornar dados frescos já nesta resposta
        if (ins.likes !== null) c.insights_likes = ins.likes;
        if (ins.comments !== null) c.insights_comments = ins.comments;
        if (ins.plays !== null) c.insights_plays = ins.plays;
        if (ins.reach !== null) c.insights_reach = ins.reach;
        c.insights_fetched_at = payload.insights_fetched_at as string;
      })
    );
  }

  // ── Contagens de progresso ──────────────────────────────────────────────
  const published = rows.filter(r => r.status === "published").length;
  const errors    = rows.filter(r => r.status === "error").length;
  const pending   = rows.filter(r => r.status === "pending").length;

  // Mensagens de erro recentes (máx 10) para diagnóstico
  const recentErrors = rows
    .filter(r => r.status === "error" && r.error_message)
    .slice(0, 10)
    .map(r => ({
      created_at: r.created_at,
      username: r.instagram_accounts?.username ?? "?",
      error_message: r.error_message,
    }));

  // ── Engajamento total ───────────────────────────────────────────────────
  const pubRows = rows.filter(r => r.status === "published");
  const totalLikes    = pubRows.reduce((s, r) => s + (r.insights_likes    ?? 0), 0);
  const totalComments = pubRows.reduce((s, r) => s + (r.insights_comments ?? 0), 0);
  const totalPlays    = pubRows.reduce((s, r) => s + (r.insights_plays    ?? 0), 0);
  const totalReach    = pubRows.reduce((s, r) => s + (r.insights_reach    ?? 0), 0);

  // ── Ranking de contas ───────────────────────────────────────────────────
  const accMap = new Map<string, {
    account_id: string;
    username: string;
    avatar_url: string | null;
    followers_count: number | null;
    posts_count: number;
    total_likes: number;
    total_comments: number;
    total_plays: number;
    engagement_score: number;
  }>();

  for (const row of rows) {
    const acc = row.instagram_accounts;
    if (!acc) continue;

    if (!accMap.has(row.account_id)) {
      accMap.set(row.account_id, {
        account_id: row.account_id,
        username: acc.username,
        avatar_url: acc.avatar_url,
        followers_count: acc.followers_count,
        posts_count: 0,
        total_likes: 0,
        total_comments: 0,
        total_plays: 0,
        engagement_score: 0,
      });
    }

    const entry = accMap.get(row.account_id)!;

    if (row.status === "published") {
      entry.posts_count++;
      entry.total_likes    += row.insights_likes    ?? 0;
      entry.total_comments += row.insights_comments ?? 0;
      entry.total_plays    += row.insights_plays    ?? 0;
    }

    // Peso: plays × 1, likes × 2, comments × 3 (engajamento ativo vale mais)
    entry.engagement_score =
      entry.total_plays * 1 +
      entry.total_likes * 2 +
      entry.total_comments * 3;
  }

  const ranking = Array.from(accMap.values())
    .sort((a, b) => b.total_likes - a.total_likes);

  return NextResponse.json({
    loop: {
      id: loop.id,
      name: loop.name,
      cycles_done: loop.cycles_done ?? 0,
      created_at: loop.created_at,
    },
    progress: {
      // total_videos = vídeos_na_pasta × contas — denominador correto de 1 ciclo completo
      total_videos: totalTarget,
      videos_in_folder: videosInFolder,
      accounts_count: accountCount,
      published,
      errors,
      pending,
      remaining: Math.max(0, totalTarget - published),
      recent_errors: recentErrors,
    },
    engagement: {
      total_likes:    totalLikes,
      total_comments: totalComments,
      total_plays:    totalPlays,
      total_reach:    totalReach,
    },
    account_ranking: ranking,
  });
}
