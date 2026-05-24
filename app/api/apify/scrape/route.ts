import { NextRequest, NextResponse } from "next/server";
import { ApifyClient } from "apify-client";

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

const resolveVideoUrl = (item: Record<string, unknown>): string =>
  (item.videoUrl as string | undefined) ||
  (item.video_url as string | undefined) ||
  (item.videoPlayUrl as string | undefined) ||
  (item.playVideoUrl as string | undefined) ||
  "";

async function scrapeReels(
  token: string,
  username: string,
  limit: number
): Promise<Array<Record<string, unknown>>> {
  const client = new ApifyClient({ token });

  const run = await client.actor(ACTOR_ID).call({
    directUrls: [`https://www.instagram.com/${username}/reels/`],
    resultsType: "posts",
    maxRequestsPerCrawl: Math.min(limit, 30),
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
    .filter((item) => item.type === "Video" || resolveVideoUrl(item as Record<string, unknown>))
    .map((item, i) => {
      const videoUrl = resolveVideoUrl(item as Record<string, unknown>);
      if (i === 0) {
        console.log(`[apify/scrape] @${username} first videoUrl: ${videoUrl.slice(0, 70) || "(empty)"}…`);
      }
      return {
        id: String(item.id ?? item.shortCode ?? i),
        shortCode: String(item.shortCode ?? ""),
        thumbnailUrl: (item.displayUrl ?? item.thumbnailUrl ?? null) as string | null,
        videoUrl,
        caption: String(item.caption ?? "").slice(0, 120),
        views: Number(item.videoViewCount ?? 0),
        likes: Number(item.likesCount ?? 0),
        comments: Number(item.commentsCount ?? 0),
        duration: Number(item.videoDuration ?? 0),
        owner: String(item.ownerUsername ?? username),
      };
    });
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { username, limit = 20 } = body as { username: string; limit?: number };

  if (!username) {
    return NextResponse.json({ error: "O campo 'username' é obrigatório." }, { status: 400 });
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
      const reels = await scrapeReels(token, username, limit);
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

  return NextResponse.json(
    { error: `Todas as ${uniqueTokens.length} chaves Apify estão esgotadas. Último erro: ${lastError}` },
    { status: 503 }
  );
}
