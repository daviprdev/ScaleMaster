/**
 * lib/reel-video-url.ts — URL de vídeo FRESCA de um Reel pelo shortcode.
 *
 * As URLs do CDN do Instagram são assinadas e expiram em horas; renovar/refetch
 * na aba Inspirações passa por aqui. HikerAPI quando configurada (fonte
 * principal), senão ScrapeCreators (post detail).
 *
 * Erros mantêm o padrão "HTTP <status>" na mensagem — as rotas mapeiam
 * 404/403 para respostas amigáveis.
 */

import { hikerConfigured, hikerMediaByCode } from "@/lib/hikerapi-client";
import { fetchPostDetail } from "@/lib/scrapecreators-client";

export function reelSourceConfigured(): boolean {
  return hikerConfigured() || Boolean(process.env.SCRAPECREATORS_API_KEY?.trim());
}

/** URL nova do vídeo, ou null se o post existe mas não tem vídeo. */
export async function fetchFreshVideoUrl(shortCode: string): Promise<string | null> {
  if (hikerConfigured()) {
    const media = await hikerMediaByCode(shortCode);
    return media.video_url ?? null;
  }
  const detail = await fetchPostDetail(`https://www.instagram.com/reel/${shortCode}/`);
  return detail.data?.xdt_shortcode_media?.video_url ?? null;
}
