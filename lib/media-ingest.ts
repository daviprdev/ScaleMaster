/**
 * media-ingest.ts — Download de mídia na ENTRADA do Scale Master.
 *
 * REGRA ARQUITETURAL (2026-09-06): a mídia entra na Biblioteca EXATAMENTE como
 * veio da fonte. Sem FFmpeg, sem remux, sem strip de metadados, sem SEI, sem
 * creation_time, sem re-encode. Os bytes que subimos para o Storage são os
 * mesmos bytes que o CDN devolveu.
 *
 * Re-hospedar (CDN → Supabase) é permitido — é transporte, não transformação.
 * Alterar o conteúdo, não.
 */

import { httpFetch } from "./http";
import { isAllowedHost } from "@/lib/safe-media-fetch";

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
/** Teto por arquivo: o container tem 2 GB e o bucket aceita até 500 MB. */
const MAX_MEDIA_BYTES = 250 * 1024 * 1024;
const MAX_REDIRECTS = 4;

/**
 * Origens de onde o servidor aceita baixar mídia (proteção SSRF): CDNs do
 * Instagram/Facebook, Apify e o Storage do PRÓPRIO projeto Supabase. Sem isso,
 * qualquer usuário fazia o servidor buscar http://python-server:8000,
 * 127.0.0.1, 169.254.169.254… e devolvia a resposta numa URL pública.
 */
export function mediaSourceHosts(): string[] {
  let ownSupabase = "";
  try {
    ownSupabase = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").hostname;
  } catch { /* sem Supabase configurado */ }
  return ["cdninstagram.com", "fbcdn.net", "apifyusercontent.com", "api.apify.com", ownSupabase].filter(Boolean);
}

/**
 * Abre a resposta da mídia remota com allowlist reavaliada a cada redirect.
 * Recusa de cara um Content-Length acima do teto.
 *
 * httpFetch (lib/http) em vez do fetch global: o Next.js 15 patcheia o fetch
 * global para o sistema de cache dele e pode corromper respostas binárias do
 * CDN do Instagram (já causou downloads de áudio-only em produção).
 */
async function openMediaResponse(
  url: string,
  { timeoutMs = 60_000, headers = CDN_DOWNLOAD_HEADERS as Record<string, string> } = {}
): Promise<Response> {
  const allowed = mediaSourceHosts();
  const signal = AbortSignal.timeout(timeoutMs);
  let current = url;
  let response: Response;

  for (let hop = 0; ; hop++) {
    if (!isAllowedHost(current, allowed)) {
      let host = "desconhecida";
      try { host = new URL(current).hostname; } catch { /* URL inválida */ }
      throw new Error(`Origem de mídia não permitida: ${host}`);
    }
    response = await httpFetch(current, { headers, signal, redirect: "manual" });
    const location = response.headers.get("location");
    if (response.status >= 300 && response.status < 400 && location) {
      await response.body?.cancel().catch(() => {});
      if (hop >= MAX_REDIRECTS) throw new Error("Excesso de redirects ao baixar a mídia.");
      current = new URL(location, current).toString();
      continue;
    }
    break;
  }

  if (!response.ok) {
    await response.body?.cancel().catch(() => {});
    throw new Error(`Download falhou: HTTP ${response.status}`);
  }
  if (Number(response.headers.get("content-length") ?? 0) > MAX_MEDIA_BYTES) {
    await response.body?.cancel().catch(() => {});
    throw new Error(`Mídia acima do limite de ${MAX_MEDIA_BYTES / 1024 / 1024} MB.`);
  }
  return response;
}

const TOO_BIG = () => new Error(`Mídia acima do limite de ${MAX_MEDIA_BYTES / 1024 / 1024} MB.`);

/**
 * Busca mídia remota inteira na memória, com o teto de bytes aplicado durante o
 * download (não depois de bufferizar tudo). Para vídeos da Biblioteca, prefira
 * streamOriginalToStorage: o Worker tem só 128 MB de memória.
 */
export async function fetchMediaBytes(
  url: string,
  opts: { timeoutMs?: number; headers?: Record<string, string> } = {}
): Promise<Buffer> {
  const response = await openMediaResponse(url, opts);
  const chunks: Buffer[] = [];
  let total = 0;
  const reader = response.body!.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_MEDIA_BYTES) {
      await reader.cancel().catch(() => {});
      throw TOO_BIG();
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks, total);
}

/**
 * Baixa a mídia e sobe os MESMOS bytes para o Supabase Storage em fluxo, sem
 * guardar o arquivo inteiro na memória (o Cloudflare Workers tem 128 MB).
 * Usa a API REST do Storage com a service role, que aceita corpo em stream.
 */
export async function streamOriginalToStorage(
  url: string,
  bucket: string,
  storagePath: string,
  { timeoutMs = 120_000, upsert = false } = {}
): Promise<{ bytes: number }> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) throw new Error("Supabase não configurado.");

  const response = await openMediaResponse(url, { timeoutMs });
  let bytes = 0;
  const counted = response.body!.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        bytes += chunk.byteLength;
        if (bytes > MAX_MEDIA_BYTES) {
          controller.error(TOO_BIG());
          return;
        }
        controller.enqueue(chunk);
      },
    })
  );

  const headers: Record<string, string> = {
    Authorization: `Bearer ${serviceKey}`,
    apikey: serviceKey,
    "Content-Type": "video/mp4",
    "x-upsert": upsert ? "true" : "false",
  };
  const length = response.headers.get("content-length");
  if (length) headers["Content-Length"] = length;

  const objectPath = storagePath.split("/").map(encodeURIComponent).join("/");
  const up = await httpFetch(`${supabaseUrl}/storage/v1/object/${bucket}/${objectPath}`, {
    method: "POST",
    headers,
    body: counted,
    signal: AbortSignal.timeout(timeoutMs),
    // Node (Docker/dev) exige duplex para corpo em stream; o Workers ignora.
    duplex: "half",
  } as RequestInit);
  if (!up.ok) {
    const text = await up.text().catch(() => "");
    throw new Error(`Storage: HTTP ${up.status} ${text.slice(0, 200)}`);
  }

  if (bytes < MIN_VALID_BYTES) {
    await httpFetch(`${supabaseUrl}/storage/v1/object/${bucket}/${objectPath}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${serviceKey}`, apikey: serviceKey },
    }).catch(() => {});
    throw new Error(`Arquivo muito pequeno para ser uma mídia válida: ${bytes} bytes`);
  }
  return { bytes };
}

/** Baixa a mídia e devolve os bytes originais, sem nenhuma transformação. */
export async function downloadOriginalMedia(
  url: string,
  timeoutMs = 60_000
): Promise<Buffer> {
  const buf = await fetchMediaBytes(url, { timeoutMs });
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
