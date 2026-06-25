import { NextRequest, NextResponse } from "next/server";
import { ApifyClient } from "apify-client";
import { resolveApifyTokens } from "@/lib/apify-token-pool";

export const runtime = "nodejs";
export const maxDuration = 30;

const ACTOR_INPUT = (url: string, limit: number) => ({
  directUrls: [url],
  resultsType: "posts",
  resultsLimit: limit,
  maxRequestsPerCrawl: Math.max(600, limit * 2),
  proxyConfiguration: {
    useApifyProxy: true,
    apifyProxyGroups: ["RESIDENTIAL"],
  },
});

export async function POST(req: NextRequest) {
  let body: { username?: string; limit?: number };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Corpo da requisição inválido." }, { status: 400 });
  }

  const { username, limit = 500 } = body;

  if (!username) {
    return NextResponse.json({ error: "O campo 'username' é obrigatório." }, { status: 400 });
  }

  const tokens = resolveApifyTokens();
  if (tokens.length === 0) {
    return NextResponse.json({
      error: "APIFY_API_TOKEN não configurado. Adicione a variável de ambiente e faça um novo deploy.",
    }, { status: 503 });
  }

  let lastError = "Erro ao iniciar busca.";

  for (let tokenIdx = 0; tokenIdx < tokens.length; tokenIdx++) {
    try {
      const client = new ApifyClient({ token: tokens[tokenIdx] });
      const run = await client.actor("apify/instagram-scraper").start(
        ACTOR_INPUT(`https://www.instagram.com/${username}/reels/`, limit)
      );
      return NextResponse.json({ runId: run.id, username, limit, fallback: false });
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
      console.warn(`[scrape/start] token ${tokenIdx} falhou: ${lastError}`);
    }
  }

  return NextResponse.json({ error: lastError }, { status: 500 });
}
