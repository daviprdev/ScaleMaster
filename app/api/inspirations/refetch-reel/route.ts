import { NextRequest, NextResponse } from "next/server";
import {
  withApifyTokenPool,
  APIFY_RATE_LIMIT_MESSAGE,
} from "@/lib/apify-token-pool";
import { ApifyClient } from "apify-client";

export const runtime = "nodejs";
export const maxDuration = 60;

async function fetchSingleReel(
  client: ApifyClient,
  shortCode: string
): Promise<string> {
  const url = `https://www.instagram.com/reel/${shortCode}/`;

  const run = await client.actor("apify/instagram-scraper").call({
    directUrls: [url],
    resultsType: "posts",
    resultsLimit: 1,
    maxRequestsPerCrawl: 30,
    proxyConfiguration: {
      useApifyProxy: true,
      apifyProxyGroups: ["RESIDENTIAL"],
    },
  });

  if (run.status !== "SUCCEEDED") {
    throw new Error(`Apify status: ${run.status}`);
  }

  const { items } = await client.dataset(run.defaultDatasetId).listItems();

  if (!Array.isArray(items) || items.length === 0) {
    throw new Error("Reel não encontrado ou indisponível.");
  }

  const item = items[0] as Record<string, unknown>;
  const videoUrl =
    (item.videoUrl as string | undefined) ||
    (item.video_url as string | undefined) ||
    (item.videoPlayUrl as string | undefined) ||
    (item.playVideoUrl as string | undefined) ||
    "";

  if (!videoUrl) {
    throw new Error(
      "URL do vídeo não disponível. O reel pode ser de uma conta restrita ou exigir autenticação."
    );
  }

  return videoUrl;
}

export async function POST(req: NextRequest) {
  let body: { shortCode?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body inválido." }, { status: 400 });
  }

  const { shortCode } = body;
  if (!shortCode) {
    return NextResponse.json({ error: "shortCode obrigatório." }, { status: 400 });
  }

  try {
    const videoUrl = await withApifyTokenPool((client) =>
      fetchSingleReel(client, shortCode)
    );
    return NextResponse.json({ videoUrl });
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
