import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getSupabaseAdmin } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type DbError = { code?: string | null; message?: string | null };
type PageResult = { data: any[] | null; error: DbError | null; count?: number | null };

// Teto de linhas por resposta do PostgREST (max-rows do Supabase).
const PAGE_SIZE = 1000;

const ACCOUNT_EMBED = "instagram_accounts(username, display_name, avatar_url)";
const INSIGHTS_COLS =
  "insights_plays, insights_reach, insights_likes, insights_comments, insights_shares, insights_saved, insights_fetched_at";

const SP_COLS =
  `id, account_id, video_id, video_url, caption, status, media_id, post_type, ` +
  `published_at, created_at, scheduled_at, ${INSIGHTS_COLS}, campaign_id, ${ACCOUNT_EMBED}`;
// pending_containers não tem video_url: o vídeo do Loop é só o video_id.
const PC_COLS =
  `id, account_id, video_id, caption, status, media_id, created_at, ${INSIGHTS_COLS}, loop_id, ${ACCOUNT_EMBED}`;

// Colunas do fila_ideal.sql. Sem ele aplicado, a consulta repete sem elas.
const SP_NEW_COLS = ", insights_plays_at";
const PC_NEW_COLS = ", insights_plays_at, published_at";

/** 42703 (Postgres) / PGRST204 (PostgREST) ou mensagem citando uma coluna do fila_ideal.sql. */
function isMissingNewColumn(err: DbError | null | undefined): boolean {
  if (!err) return false;
  return err.code === "42703" || err.code === "PGRST204" ||
    /insights_plays_at|published_at/.test(err.message ?? "");
}

/**
 * Linhas [0, end) de uma consulta já ordenada, em páginas de PAGE_SIZE (o
 * PostgREST corta cada resposta nesse teto). A contagem exata vem da 1ª página.
 */
async function fetchWindow(
  build: (from: number, to: number) => PromiseLike<PageResult>,
  end: number,
): Promise<{ rows: any[]; count: number; error: DbError | null }> {
  const rows: any[] = [];
  let count = 0;
  for (let from = 0; from < end; from += PAGE_SIZE) {
    const to = Math.min(end, from + PAGE_SIZE) - 1;
    const { data, error, count: pageCount } = await build(from, to);
    if (error) return { rows, count, error };
    if (from === 0) count = pageCount ?? 0;
    const page = data ?? [];
    rows.push(...page);
    if (page.length < to - from + 1) break;
  }
  return { rows, count, error: null };
}

/** A janela com as colunas novas; se o banco ainda não as tem, repete uma vez sem elas. */
async function fetchSource(
  build: (cols: string, from: number, to: number) => PromiseLike<PageResult>,
  fullCols: string,
  baseCols: string,
  end: number,
) {
  const full = await fetchWindow((from, to) => build(fullCols, from, to), end);
  if (!isMissingNewColumn(full.error)) return full;
  return fetchWindow((from, to) => build(baseCols, from, to), end);
}

/**
 * GET /api/published
 *
 * Retorna todas as publicações concluídas (status='published') do usuário,
 * unificando duas fontes:
 *   - scheduled_posts  → Postar manual, Clonar, Stories
 *   - pending_containers → Loop
 *
 * Query params opcionais:
 *   account_id  — filtra por conta específica
 *   limit       — máximo de registros (default 500, max 2000)
 *   offset      — paginação sobre a lista unificada (default 0)
 *
 * Cada item traz views_read_at: hora da última leitura que trouxe views
 * (insights_plays_at, ou insights_fetched_at nas linhas antigas). Nulo = ainda
 * sem leitura.
 */
export async function GET(request: NextRequest) {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
    return NextResponse.json({ items: [], total: 0, accounts: [] });
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });

  const admin = getSupabaseAdmin() as any;
  const { searchParams } = new URL(request.url);
  const accountId = searchParams.get("account_id") || null;
  const limit = Math.min(2000, Math.max(1, Number(searchParams.get("limit")) || 500));
  const offset = Math.max(0, Number(searchParams.get("offset")) || 0);

  // ── 1. Buscar contas ativas do usuário ──────────────────────────────
  const { data: accountsData, error: accountsError } = await admin
    .from("instagram_accounts")
    .select("id, username, display_name, avatar_url, is_active, followers_count")
    .eq("user_id", user.id)
    .eq("is_active", true)
    .order("username", { ascending: true });
  if (accountsError) console.error("[published] contas:", accountsError.code, accountsError.message);

  const accounts = (accountsData ?? []).map((a: any) => ({
    id: a.id,
    username: a.username,
    display_name: a.display_name,
    avatar_url: a.avatar_url,
    followers_count: a.followers_count,
  }));

  // ── 2–3. scheduled_posts (Postar) e pending_containers (Loop) ───────
  // O offset vale para a lista unificada: cada fonte entrega as primeiras
  // offset+limit linhas, a união é ordenada e cortada em [offset, offset+limit).
  const end = offset + limit;

  const [sp, pc] = await Promise.all([
    fetchSource((cols, from, to) => {
      let q = admin
        .from("scheduled_posts")
        .select(cols, from === 0 ? { count: "exact" } : undefined)
        .eq("user_id", user.id)
        .eq("status", "published");
      if (accountId) q = q.eq("account_id", accountId);
      return q
        .order("published_at", { ascending: false })
        .order("id", { ascending: false })
        .range(from, to);
    }, SP_COLS + SP_NEW_COLS, SP_COLS, end),
    fetchSource((cols, from, to) => {
      let q = admin
        .from("pending_containers")
        .select(cols, from === 0 ? { count: "exact" } : undefined)
        .eq("user_id", user.id)
        .eq("status", "published");
      if (accountId) q = q.eq("account_id", accountId);
      return q
        .order("created_at", { ascending: false })
        .order("id", { ascending: false })
        .range(from, to);
    }, PC_COLS + PC_NEW_COLS, PC_COLS, end),
  ]);

  // Uma fonte falhando não some em silêncio da lista: a rota falha inteira.
  if (sp.error || pc.error) {
    if (sp.error) console.error("[published] scheduled_posts:", sp.error.code, sp.error.message);
    if (pc.error) console.error("[published] pending_containers:", pc.error.code, pc.error.message);
    return NextResponse.json({ error: "Não foi possível carregar as publicações." }, { status: 500 });
  }

  // ── 4. Unificar e normalizar ────────────────────────────────────────
  type PublishedItem = {
    id: string;
    source: "scheduled" | "loop";
    account_id: string | null;
    username: string | null;
    display_name: string | null;
    avatar_url: string | null;
    type: "story" | "reel";
    views: number | null;
    reach: number | null;
    likes: number | null;
    comments: number | null;
    shares: number | null;
    saved: number | null;
    views_read_at: string | null;
    caption: string | null;
    media_id: string | null;
    video_id: string | null;
    video_url: string | null;
    published_at: string;
    campaign_id: string | null;
    loop_id: string | null;
  };

  const items: PublishedItem[] = [];

  for (const row of sp.rows) {
    const acc = Array.isArray(row.instagram_accounts)
      ? row.instagram_accounts[0]
      : row.instagram_accounts;
    items.push({
      id: row.id,
      source: "scheduled",
      account_id: row.account_id,
      username: acc?.username ?? null,
      display_name: acc?.display_name ?? null,
      avatar_url: acc?.avatar_url ?? null,
      type: row.post_type === "story" ? "story" : "reel",
      views: row.insights_plays ?? null,
      reach: row.insights_reach ?? null,
      likes: row.insights_likes ?? null,
      comments: row.insights_comments ?? null,
      shares: row.insights_shares ?? null,
      saved: row.insights_saved ?? null,
      views_read_at: row.insights_plays_at ?? row.insights_fetched_at ?? null,
      caption: row.caption ?? null,
      media_id: row.media_id ?? null,
      video_id: row.video_id ?? null,
      video_url: row.video_url ?? null,
      published_at: row.published_at ?? row.created_at,
      campaign_id: row.campaign_id ?? null,
      loop_id: null,
    });
  }

  for (const row of pc.rows) {
    const acc = Array.isArray(row.instagram_accounts)
      ? row.instagram_accounts[0]
      : row.instagram_accounts;
    items.push({
      id: row.id,
      source: "loop",
      account_id: row.account_id,
      username: acc?.username ?? null,
      display_name: acc?.display_name ?? null,
      avatar_url: acc?.avatar_url ?? null,
      type: "reel",
      views: row.insights_plays ?? null,
      reach: row.insights_reach ?? null,
      likes: row.insights_likes ?? null,
      comments: row.insights_comments ?? null,
      shares: row.insights_shares ?? null,
      saved: row.insights_saved ?? null,
      views_read_at: row.insights_plays_at ?? row.insights_fetched_at ?? null,
      caption: row.caption ?? null,
      media_id: row.media_id ?? null,
      video_id: row.video_id ?? null,
      video_url: null,
      // published_at gravado pelo publish-pending; linhas antigas caem no created_at.
      published_at: row.published_at ?? row.created_at,
      campaign_id: null,
      loop_id: row.loop_id ?? null,
    });
  }

  // Ordenar por data descendente
  items.sort((a, b) => {
    const da = a.published_at ? new Date(a.published_at).getTime() : 0;
    const db = b.published_at ? new Date(b.published_at).getTime() : 0;
    return db - da;
  });

  // Janela pedida da lista unificada
  const trimmed = items.slice(offset, end);
  const total = sp.count + pc.count;

  // ── 5. Stats resumidos (das publicações devolvidas, Postar + Loop) ──
  const sumViews = (list: PublishedItem[]) => list.reduce((sum, i) => sum + (i.views ?? 0), 0);
  const totalViews = sumViews(trimmed);
  const postarViews = sumViews(trimmed.filter(i => i.source === "scheduled"));
  const totalReach = trimmed.reduce((sum, i) => sum + (i.reach ?? 0), 0);
  const storyCount = trimmed.filter(i => i.type === "story").length;
  const reelCount = trimmed.filter(i => i.type === "reel").length;

  return NextResponse.json({
    items: trimmed,
    total,
    accounts,
    stats: {
      total_views: totalViews,
      postar_views: postarViews,
      loop_views: totalViews - postarViews,
      total_reach: totalReach,
      stories: storyCount,
      reels: reelCount,
    },
  });
}
