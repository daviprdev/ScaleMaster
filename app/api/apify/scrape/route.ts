import { NextRequest, NextResponse } from "next/server";
import { ApifyClient } from "apify-client";

export const runtime = "nodejs";
export const maxDuration = 120;

const RATE_LIMIT_MESSAGE =
  "Nosso sistema de buscas está sobrecarregado no momento. Aguarde 5 minutos e tente novamente.";

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

function resolveVideoUrl(item: Record<string, unknown>): string {
  return (
    (item.videoUrl as string | undefined) ||
    (item.video_url as string | undefined) ||
    (item.videoPlayUrl as string | undefined) ||
    (item.playVideoUrl as string | undefined) ||
    ""
  );
}

async function scrapeReels(
  token: string,
  username: string,
  limit: number
): Promise<Array<Record<string, unknown>>> {
  const client = new ApifyClient({ token });

  const run = await client.actor("apify~instagram-reel-scraper").call({
    username: [username],
    resultsLimit: Math.min(limit, 300),
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
      const raw = item as Record<string, unknown>;
      const videoUrl = resolveVideoUrl(raw);
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

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { username, limit = 300 } = body as { username: string; limit?: number };

  if (!username) {
    return NextResponse.json({ error: "O campo 'username' é obrigatório." }, { status: 400 });
  }

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
          "APIFY_API_TOKEN não configurado. Adicione a variável de ambiente e faça um novo deploy.",
      },
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

  return NextResponse.json({ error: RATE_LIMIT_MESSAGE }, { status: 429 });
}
