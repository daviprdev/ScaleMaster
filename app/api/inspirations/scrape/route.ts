import { NextRequest, NextResponse } from "next/server";
import { ApifyClient } from "apify-client";
import { resolveApifyTokens } from "@/lib/apify-token-pool";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 30;

const ACTOR_INPUT = (url: string, limit: number) => ({
  directUrls: [url],
  resultsType: "posts",
  resultsLimit: limit,
  maxRequestsPerCrawl: Math.max(600, limit * 2),
  proxyConfiguration: { useApifyProxy: true },
});

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });

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

  // Inicia um run por token em paralelo — cada run coleta ~100 reels de IPs diferentes.
  // Com N tokens: N × ~100 = N × 100 reels únicos após deduplicação.
  const url = `https://www.instagram.com/${username}/reels/`;
  const starts = await Promise.allSettled(
    tokens.map(async (token) => {
      const client = new ApifyClient({ token });
      const run = await client.actor("apify/instagram-scraper").start(ACTOR_INPUT(url, limit));
      return run.id;
    })
  );

  const runIds = starts
    .filter((r): r is PromiseFulfilledResult<string> => r.status === "fulfilled")
    .map((r) => r.value);

  if (runIds.length === 0) {
    const firstErr = starts.find((r) => r.status === "rejected") as PromiseRejectedResult | undefined;
    const msg = firstErr?.reason instanceof Error ? firstErr.reason.message : "Erro ao iniciar busca.";
    return NextResponse.json({ error: msg }, { status: 500 });
  }

  console.log(`[scrape] @${username} — ${runIds.length}/${tokens.length} runs iniciados`);
  return NextResponse.json({ runIds, limit });
}
