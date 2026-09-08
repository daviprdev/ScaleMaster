/**
 * media-ingest.ts — Download de mídia na ENTRADA do AutoScale.
 *
 * REGRA ARQUITETURAL (2026-09-06): a mídia entra na Biblioteca EXATAMENTE como
 * veio da fonte. Sem FFmpeg, sem remux, sem strip de metadados, sem SEI, sem
 * creation_time, sem re-encode. Os bytes que subimos para o Storage são os
 * mesmos bytes que o CDN devolveu.
 *
 * Re-hospedar (CDN → Supabase) é permitido — é transporte, não transformação.
 * Alterar o conteúdo, não.
 */

import { fetch as undiciFetch } from "undici";

/** Headers de iPhone: o CDN do Instagram devolve 403 para User-Agents genéricos. */
export const CDN_DOWNLOAD_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (iPhone; CPU iPhone OS 16_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.5 Mobile/15E148 Safari/604.1",
  Referer: "https://www.instagram.com/",
  Origin: "https://www.instagram.com",
  Accept: "video/mp4,video/webm,*/*;q=0.8",
  Connection: "keep-alive",
};

const MIN_VALID_BYTES = 1024;

/**
 * Baixa a mídia e devolve os bytes originais, sem nenhuma transformação.
 *
 * undici em vez do fetch global: o Next.js 15 patcheia o fetch global para o
 * sistema de cache dele e pode corromper respostas binárias do CDN do Instagram
 * (já causou downloads de áudio-only em produção).
 */
export async function downloadOriginalMedia(
  url: string,
  timeoutMs = 60_000
): Promise<Buffer> {
  const response = await undiciFetch(url, {
    headers: CDN_DOWNLOAD_HEADERS,
    signal: AbortSignal.timeout(timeoutMs),
  });

  if (!response.ok) {
    throw new Error(`Download falhou: HTTP ${response.status}`);
  }

  const buf = Buffer.from(await response.arrayBuffer());
  if (buf.byteLength < MIN_VALID_BYTES) {
    throw new Error(`Arquivo muito pequeno para ser uma mídia válida: ${buf.byteLength} bytes`);
  }
  return buf;
}

/** Nome estável de arquivo no Storage para uma mídia recém-ingerida. */
export function buildLibraryStoragePath(baseName: string, uid: string): string {
  const safe = baseName.replace(/[^a-z0-9_-]/gi, "_").slice(0, 60);
  return `videos/${safe}_${Date.now()}_${uid.slice(0, 8)}.mp4`;
}

/**
 * Coerção para as colunas INTEIRAS de `videos_library`
 * (`duration` integer; `views`, `likes`, `comments` bigint).
 *
 * O actor `apify/instagram-scraper` devolve `videoDuration` FRACIONÁRIO
 * (ex.: 18.266666) e o Postgres rejeita o INSERT inteiro com
 * `invalid input syntax for type integer`. Em 2026-09-08 isso reprovou 120 de
 * 124 Reels numa única importação — os 4 que passaram foram os de duração
 * redonda. Só não estourou antes porque nenhum caminho de ingestão ativo
 * gravava a duração vinda do Apify.
 *
 * Arredondar é correto para o dado: a duração é exibida em segundos inteiros.
 * Não vale para nenhum campo cujo valor fracionário importe.
 */
export function toIntegerColumn(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.round(n));
}
