import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { fetchPostDetail } from "@/lib/scrapecreators-client";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * Renovação de URLs de vídeo expiradas — EM LOTE via ScrapeCreators.
 *
 * Contexto: as URLs de vídeo do CDN do Instagram (fbcdn) são ASSINADAS e
 * expiram em poucas horas. Quando o usuário raspa um perfil grande e só depois
 * manda "Salvar todos na Biblioteca", a maioria das URLs da raspagem já está
 * morta → o download devolve HTTP 403 e o salvamento falha em massa.
 *
 * Aqui buscamos os detalhes de cada Reel individualmente via /v1/instagram/post
 * da ScrapeCreators para obter URLs frescas. Cada chamada custa 1 crédito.
 *
 * Body: { shortCodes: string[] }
 * Resp: { urls: { [shortCode]: freshVideoUrl } }
 */

const MAX_SHORTCODES = 50;

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });

  if (!process.env.SCRAPECREATORS_API_KEY?.trim()) {
    return NextResponse.json(
      { error: "SCRAPECREATORS_API_KEY não configurado." },
      { status: 503 }
    );
  }

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

  const urls: Record<string, string> = {};
  const errors: string[] = [];

  // Processa sequencialmente para respeitar rate limits
  for (const sc of shortCodes) {
    try {
      const reelUrl = `https://www.instagram.com/reel/${sc}/`;
      const detail = await fetchPostDetail(reelUrl);
      const videoUrl = detail.data?.xdt_shortcode_media?.video_url;
      if (videoUrl) {
        urls[sc] = videoUrl;
      } else {
        errors.push(sc);
      }
    } catch (err) {
      console.error(`[refresh-urls] falha ao renovar ${sc}:`, err instanceof Error ? err.message : err);
      errors.push(sc);
    }
  }

  console.log(
    `[refresh-urls] renovadas ${Object.keys(urls).length}/${shortCodes.length} URLs via ScrapeCreators`
  );

  return NextResponse.json({ urls, errors: errors.length > 0 ? errors : undefined });
}