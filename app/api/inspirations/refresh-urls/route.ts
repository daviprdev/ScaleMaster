import { NextRequest, NextResponse } from "next/server";
import {
  withApifyTokenPool,
  APIFY_RATE_LIMIT_MESSAGE,
} from "@/lib/apify-token-pool";
import { ApifyClient } from "apify-client";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * Renovação de URLs de vídeo expiradas — EM LOTE, numa ÚNICA run de Apify.
 *
 * Contexto: as URLs de vídeo do CDN do Instagram (fbcdn) são ASSINADAS e
 * expiram em poucas horas. Quando o usuário raspa um perfil grande e só depois
 * manda "Salvar todos na Biblioteca", a maioria das URLs da raspagem já está
 * morta → o download devolve HTTP 403 e o salvamento falha em massa
 * (400+ reels, só ~20 salvos — incidente de 2026-09-15).
 *
 * `refetch-reel` resolve UM reel por run — a 400 reels seriam 400 runs de
 * Apify, o que estoura o orçamento de tokens (justamente a dor do usuário).
 * Aqui passamos VÁRIOS reels como `directUrls` na MESMA run: um único run do
 * `apify/instagram-scraper` devolve URLs frescas para todos os shortCodes do
 * lote. O frontend chama isto só quando o download realmente falha por
 * expiração — se as URLs ainda estão frescas, zero Apify extra.
 *
 * Body: { shortCodes: string[] }  (o frontend fatia em chunks — ver page.tsx)
 * Resp: { urls: { [shortCode]: freshVideoUrl } }
 */

const MAX_SHORTCODES = 50;

function extractShortCode(item: Record<string, unknown>): string | null {
  const direct =
    (item.shortCode as string | undefined) ||
    (item.shortcode as string | undefined) ||
    (item.code as string | undefined);
  if (direct) return direct;

  // Fallback: derivar do permalink (…/reel/{code}/ ou …/p/{code}/)
  const url = (item.url as string | undefined) || (item.postUrl as string | undefined);
  if (url) {
    const m = url.match(/\/(?:reel|p|tv)\/([^/?#]+)/i);
    if (m) return m[1];
  }
  return null;
}

function extractVideoUrl(item: Record<string, unknown>): string {
  return (
    (item.videoUrl as string | undefined) ||
    (item.video_url as string | undefined) ||
    (item.videoPlayUrl as string | undefined) ||
    (item.playVideoUrl as string | undefined) ||
    ""
  );
}

async function refreshBatch(
  client: ApifyClient,
  shortCodes: string[]
): Promise<Record<string, string>> {
  const directUrls = shortCodes.map(
    (sc) => `https://www.instagram.com/reel/${sc}/`
  );

  const run = await client.actor("apify/instagram-scraper").call({
    directUrls,
    resultsType: "posts",
    resultsLimit: shortCodes.length,
    // Folga para o crawler resolver todos os permalinks do lote.
    maxRequestsPerCrawl: Math.max(30, shortCodes.length * 2),
    proxyConfiguration: {
      useApifyProxy: true,
      apifyProxyGroups: ["RESIDENTIAL"],
    },
  });

  if (run.status !== "SUCCEEDED") {
    throw new Error(`Apify status: ${run.status}`);
  }

  const { items } = await client.dataset(run.defaultDatasetId).listItems();
  const map: Record<string, string> = {};

  if (Array.isArray(items)) {
    for (const raw of items) {
      const item = raw as Record<string, unknown>;
      const sc = extractShortCode(item);
      const videoUrl = extractVideoUrl(item);
      if (sc && videoUrl) map[sc] = videoUrl;
    }
  }

  return map;
}

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });

  let body: { shortCodes?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body inválido." }, { status: 400 });
  }

  const shortCodes = Array.isArray(body.shortCodes)
    ? [...new Set(body.shortCodes.filter((s): s is string => typeof s === "string" && s.trim() !== ""))]
    : [];

  if (shortCodes.length === 0) {
    return NextResponse.json({ error: "shortCodes obrigatório." }, { status: 400 });
  }
  if (shortCodes.length > MAX_SHORTCODES) {
    return NextResponse.json(
      { error: `Máximo de ${MAX_SHORTCODES} reels por chamada.` },
      { status: 400 }
    );
  }

  try {
    const urls = await withApifyTokenPool((client) => refreshBatch(client, shortCodes));
    console.log(
      `[refresh-urls] renovadas ${Object.keys(urls).length}/${shortCodes.length} URLs numa run`
    );
    return NextResponse.json({ urls });
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
