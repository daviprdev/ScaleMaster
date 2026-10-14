import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { fetchPostDetail } from "@/lib/scrapecreators-client";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Re-busca a URL de vídeo de um único Reel via ScrapeCreators (post detail).
 * Usado quando a URL original expirou (CDN do Instagram assina URLs temporárias).
 */
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

  const reelUrl = `https://www.instagram.com/reel/${shortCode}/`;

  try {
    const detail = await fetchPostDetail(reelUrl);
    const media = detail.data?.xdt_shortcode_media;
    const videoUrl = media?.video_url;

    if (!videoUrl) {
      return NextResponse.json(
        { error: "URL do vídeo não disponível. O Reel pode ser privado ou ter sido removido." },
        { status: 404 }
      );
    }

    return NextResponse.json({ videoUrl });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // Não vaza detalhes internos
    if (msg.includes("HTTP 404")) {
      return NextResponse.json(
        { error: "Reel não encontrado ou indisponível." },
        { status: 404 }
      );
    }
    if (msg.includes("HTTP 403")) {
      return NextResponse.json(
        { error: "Acesso negado ao Reel. Pode ser privado ou restrito." },
        { status: 403 }
      );
    }
    console.error(`[refetch-reel] @${shortCode}:`, msg);
    return NextResponse.json({ error: "Falha ao buscar URL do vídeo." }, { status: 500 });
  }
}