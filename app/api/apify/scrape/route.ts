import { NextRequest, NextResponse } from "next/server";
import { ApifyClient } from "apify-client";

export const runtime = "nodejs";
export const maxDuration = 120;

// ── Constants ─────────────────────────────────────────────────
const RATE_LIMIT_MESSAGE =
  "Nosso sistema de buscas está sobrecarregado no momento. Aguarde 5 minutos e tente novamente.";

// ── Type ──────────────────────────────────────────────────────
interface ScrapedReel {
  id: string;
  shortCode: string;
  thumbnailUrl: string | null;
  videoUrl: string;
  caption: string;
  views: number;
  likes: number;
  comments: number;
  duration: number;
  owner: string;
}

// ── Error helpers ──────────────────────────────────────────────
function isRateLimitError(msg: string): boolean {
  const m = msg.toLowerCase();
  return (
    m.includes("429") ||
    m.includes("rate limit") ||
    m.includes("too many") ||
    m.includes("sobrecarregado")
  );
}

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

// ── Strategy 1: RapidAPI with pagination ──────────────────────
// Default host: instagram-scraper-api2.p.rapidapi.com (lamboiss)
// Override via RAPIDAPI_INSTAGRAM_HOST env var
// Paginates with next_max_id until `limit` reels are collected or no more pages
async function scrapeViaRapidAPI(username: string, limit: number): Promise<ScrapedReel[]> {
  const apiKey = process.env.RAPIDAPI_KEY;
  if (!apiKey) throw new Error("RAPIDAPI_KEY not configured");

  const host =
    process.env.RAPIDAPI_INSTAGRAM_HOST ?? "instagram-scraper-api2.p.rapidapi.com";

  const allItems: Record<string, unknown>[] = [];
  let nextMaxId: string | null = null;
  const MAX_PAGES = 8; // safety cap — 8 × ~12 items = ~96 reels max

  for (let page = 0; page < MAX_PAGES && allItems.length < limit; page++) {
    const params = new URLSearchParams({ username_or_id_or_url: username });
    if (nextMaxId) params.set("next_max_id", nextMaxId);

    const res = await fetch(`https://${host}/v1/posts?${params}`, {
      headers: {
        "x-rapidapi-key": apiKey,
        "x-rapidapi-host": host,
      },
    });

    if (res.status === 429) throw new Error(RATE_LIMIT_MESSAGE);

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(
        `RapidAPI retornou ${res.status}${body ? `: ${body.slice(0, 120)}` : ""}`
      );
    }

    const data = (await res.json()) as Record<string, unknown>;
    const pageData = (data?.data as Record<string, unknown>) ?? data;
    const pageItems = (pageData?.items as unknown[]) ?? [];

    if (!Array.isArray(pageItems) || pageItems.length === 0) break;

    // Keep only video content (media_type 2 = reel/video)
    const videoItems = (pageItems as Record<string, unknown>[]).filter(
      (item) => item.media_type === 2 || item.video_url || item.videoUrl
    );
    allItems.push(...videoItems);

    console.log(
      `[rapidapi] @${username} page ${page + 1}: ${videoItems.length} reels (total ${allItems.length})`
    );

    const moreAvailable = pageData?.more_available as boolean | undefined;
    nextMaxId = (pageData?.next_max_id as string | null | undefined) ?? null;
    if (!moreAvailable || !nextMaxId) break;
  }

  if (allItems.length === 0) {
    throw new Error(
      `Nenhum Reel encontrado para @${username}. O perfil pode ser privado, inexistente ou não ter Reels.`
    );
  }

  return allItems.slice(0, limit).map((item, i) => {
    const captionObj = item.caption as Record<string, unknown> | string | null | undefined;
    const captionText =
      typeof captionObj === "string"
        ? captionObj
        : ((captionObj as Record<string, unknown> | null)?.text as string | undefined) ?? "";

    const userObj = item.user as Record<string, unknown> | null | undefined;
    const imgVersions = item.image_versions2 as Record<string, unknown> | null | undefined;
    const candidates = imgVersions?.candidates as Array<Record<string, unknown>> | undefined;

    return {
      id: String(item.pk ?? item.id ?? i),
      shortCode: String(item.code ?? item.shortcode ?? ""),
      thumbnailUrl:
        (item.thumbnail_url as string | null | undefined) ??
        (candidates?.[0]?.url as string | null | undefined) ??
        null,
      videoUrl: String(item.video_url ?? item.videoUrl ?? ""),
      caption: String(captionText).slice(0, 120),
      views: Number(item.view_count ?? item.play_count ?? 0),
      likes: Number(item.like_count ?? 0),
      comments: Number(item.comment_count ?? 0),
      duration: Number(item.video_duration ?? 0),
      owner: String(userObj?.username ?? username),
    };
  });
}

// ── Strategy 2: Apify (reel-specific actor) ────────────────────
async function scrapeViaApify(
  token: string,
  username: string,
  limit: number
): Promise<ScrapedReel[]> {
  const client = new ApifyClient({ token });

  // apify~instagram-reel-scraper: targeted for reels, less prone to IG blocks
  const run = await client.actor("apify~instagram-reel-scraper").call({
    username: [username],
    resultsLimit: Math.min(limit, 100),
  });

  if (run.status !== "SUCCEEDED") {
    throw new Error(`Actor encerrou com status inesperado: ${run.status}`);
  }

  const { items } = await client.dataset(run.defaultDatasetId).listItems();

  if (!Array.isArray(items) || items.length === 0) {
    throw new Error(
      `Nenhum Reel encontrado para @${username}. ` +
        `O perfil pode ser privado, inexistente, não ter Reels ou ` +
        `o Instagram está bloqueando temporariamente a coleta. ` +
        `Tente novamente em alguns minutos.`
    );
  }

  return items
    .filter(
      (item) =>
        item.type === "Video" ||
        item.videoUrl ||
        item.video_url ||
        item.videoPlayUrl
    )
    .map((item, i) => {
      const raw = item as Record<string, unknown>;
      const videoUrl =
        (raw.videoUrl as string | undefined) ||
        (raw.video_url as string | undefined) ||
        (raw.videoPlayUrl as string | undefined) ||
        "";
      if (i === 0) {
        console.log(
          `[apify/scrape] @${username} first videoUrl: ${videoUrl.slice(0, 70) || "(empty)"}…`
        );
      }
      return {
        id: String(raw.id ?? raw.shortCode ?? i),
        shortCode: String(raw.shortCode ?? ""),
        thumbnailUrl: (raw.displayUrl ?? raw.thumbnailUrl ?? null) as string | null,
        videoUrl,
        caption: String(raw.caption ?? "").slice(0, 120),
        views: Number(raw.videoViewCount ?? 0),
        likes: Number(raw.likesCount ?? 0),
        comments: Number(raw.commentsCount ?? 0),
        duration: Number(raw.videoDuration ?? 0),
        owner: String(raw.ownerUsername ?? username),
      };
    });
}

// ── Handler ────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  const body = await req.json();
  const { username, limit = 50 } = body as { username: string; limit?: number };

  if (!username) {
    return NextResponse.json(
      { error: "O campo 'username' é obrigatório." },
      { status: 400 }
    );
  }

  // ── Strategy 1: RapidAPI — distributed proxies, no cold start ──
  if (process.env.RAPIDAPI_KEY) {
    try {
      const reels = await scrapeViaRapidAPI(username, limit);
      return NextResponse.json({ reels });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (isRateLimitError(msg)) {
        return NextResponse.json({ error: RATE_LIMIT_MESSAGE }, { status: 429 });
      }
      console.warn(`[scrape] RapidAPI falhou para @${username}: ${msg}. Tentando Apify…`);
    }
  }

  // ── Strategy 2: Apify fallback ──────────────────────────────
  const tokens = [
    ...(process.env.APIFY_API_TOKENS?.split(",") ?? []),
    ...(process.env.APIFY_API_TOKEN?.split(",") ?? []),
  ]
    .map((t) => t.trim())
    .filter(Boolean);

  const uniqueTokens = [...new Set(tokens)];

  if (uniqueTokens.length === 0) {
    return NextResponse.json(
      {
        error:
          "Nenhum provedor de scraping configurado. Configure RAPIDAPI_KEY ou APIFY_API_TOKEN.",
      },
      { status: 503 }
    );
  }

  let lastError = "Erro desconhecido";

  for (const token of uniqueTokens) {
    try {
      const reels = await scrapeViaApify(token, username, limit);
      return NextResponse.json({ reels });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (isQuotaError(msg)) {
        console.warn(`[apify/scrape] Token ...${token.slice(-6)} esgotado: ${msg}`);
        lastError = msg;
        continue;
      }
      return NextResponse.json({ error: msg }, { status: 500 });
    }
  }

  // All providers exhausted
  return NextResponse.json({ error: RATE_LIMIT_MESSAGE }, { status: 429 });
}
