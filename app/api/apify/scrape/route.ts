import { NextRequest, NextResponse } from "next/server";
import { ApifyClient } from "apify-client";
import {
  withApifyTokenPool,
  APIFY_RATE_LIMIT_MESSAGE,
} from "@/lib/apify-token-pool";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 120;

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
  client: ApifyClient,
  username: string,
  limit: number
): Promise<Array<Record<string, unknown>>> {
  const run = await client.actor("apify/instagram-scraper").call({
    directUrls: [`https://www.instagram.com/${username}/reels/`],
    resultsType: "posts",
    resultsLimit: Math.min(limit, 250),
    maxRequestsPerCrawl: Math.ceil(limit / 12) + 10,
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
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });

  const body = await req.json();
  const { username, limit = 300 } = body as { username: string; limit?: number };

  if (!username) {
    return NextResponse.json({ error: "O campo 'username' é obrigatório." }, { status: 400 });
  }

  try {
    const reels = await withApifyTokenPool((client) =>
      scrapeReels(client, username, limit)
    );
    return NextResponse.json({ reels });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);

    if (msg.startsWith("NO_TOKENS:")) {
      return NextResponse.json({ error: msg.replace("NO_TOKENS: ", "") }, { status: 503 });
    }
    if (msg.startsWith("ALL_TOKENS_FAILED:")) {
      return NextResponse.json({ error: APIFY_RATE_LIMIT_MESSAGE }, { status: 429 });
    }
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
