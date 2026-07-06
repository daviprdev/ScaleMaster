import { NextRequest, NextResponse } from "next/server";
import { ApifyClient } from "apify-client";
import { resolveApifyTokens } from "@/lib/apify-token-pool";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });

  let body: { username?: string; limit?: number };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Corpo inválido." }, { status: 400 });
  }

  const { username, limit = 500 } = body;
  if (!username) {
    return NextResponse.json({ error: "O campo 'username' é obrigatório." }, { status: 400 });
  }

  const tokens = resolveApifyTokens();
  if (!tokens.length) {
    return NextResponse.json({ error: "APIFY_API_TOKEN não configurado." }, { status: 503 });
  }

  let lastError = "Erro ao iniciar busca.";

  for (const token of tokens) {
    try {
      const client = new ApifyClient({ token });
      const run = await client.actor("apify/instagram-scraper").start({
        directUrls: [`https://www.instagram.com/${username}/reels/`],
        resultsType: "posts",
        resultsLimit: limit,
        maxRequestsPerCrawl: Math.ceil(limit / 8) + 40,
        proxyConfiguration: { useApifyProxy: true },
      });
      return NextResponse.json({ runId: run.id, username, limit, fallback: false });
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
    }
  }

  return NextResponse.json({ error: lastError }, { status: 500 });
}
