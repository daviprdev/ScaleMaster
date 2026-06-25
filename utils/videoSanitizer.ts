/**
 * videoSanitizer.ts — Pipeline de limpeza para downloads de Inspirações
 *
 * Usado em dois contextos:
 *   - sanitizeForLibrary:  salvar Inspiração na Biblioteca (upload Supabase)
 *   - sanitizeForDownload: baixar Inspiração no dispositivo do usuário
 *
 * Pipeline (stream copy + limpeza completa):
 *   -map 0:v:0                         — primeira trilha de vídeo; descarta data streams
 *   -map 0:a:0?                        — primeira trilha de áudio (opcional)
 *   -c:v copy -c:a copy                — stream copy; zero re-encode, qualidade máxima
 *   -bsf:v filter_units=remove_types=6 — remove TODAS as SEI NAL units (tipo 6 H.264).
 *                                        SEI NAL units carregam SEI payload types:
 *                                          payload 5 (user_data_unregistered): UUIDs CDN
 *                                          payload 4 (user_data_registered):   fingerprint Instagram/TikTok
 *                                        NAL unit tipo 5 = IDR keyframes — NÃO deve ser removido.
 *                                        Sobrevivem ao -map_metadata pois estão no bitstream,
 *                                        não nos átomos do container MP4.
 *   -map_metadata -1                   — remove metadados do container (EXIF, GPS, encoder)
 *   -metadata creation_time=...        — injeta data realista (parece captura original)
 *   -map_chapters -1                   — remove chapter markers
 *   -movflags +faststart               — moov atom na frente para playback progressivo
 *   -f mp4                             — container MP4 limpo
 */

import ffmpeg from "fluent-ffmpeg";
import ffmpegInstaller from "@ffmpeg-installer/ffmpeg";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import * as crypto from "crypto";
import { fetch as undiciFetch } from "undici";

ffmpeg.setFfmpegPath(ffmpegInstaller.path);

export interface SanitizeResult {
  outputPath:  string;
  storagePath: string;
  fileSize:    number;
  cleanup:     () => void;
}

const DOWNLOAD_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (iPhone; CPU iPhone OS 16_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.5 Mobile/15E148 Safari/604.1",
  Referer:    "https://www.instagram.com/",
  Origin:     "https://www.instagram.com",
  Accept:     "video/mp4,video/webm,*/*;q=0.8",
  Connection: "keep-alive",
};

// Data de criação fake: parece captura original, não download.
// Ausência de creation_time é sinal detectável de "arquivo baixado".
function randomCreationTime(): string {
  const ninetyDaysMs = 90 * 24 * 60 * 60 * 1000;
  const ts = Date.now() - Math.floor(Math.random() * ninetyDaysMs);
  return new Date(ts).toISOString();
}

// Opções FFmpeg comuns a todos os pipelines de sanitização
function buildSanitizeOptions(): string[] {
  return [
    "-map 0:v:0",
    "-map 0:a:0?",
    "-c:v",          "copy",
    "-c:a",          "copy",
    "-bsf:v",        "filter_units=remove_types=6",
    "-map_metadata", "-1",
    "-metadata",     `creation_time=${randomCreationTime()}`,
    "-map_chapters", "-1",
    "-movflags",     "+faststart",
    "-f",            "mp4",
  ];
}

async function downloadVideo(videoUrl: string, destPath: string): Promise<void> {
  // undici bypasses Next.js 15's patched global fetch (which strips dispatcher
  // and can corrupt binary responses from Instagram CDN — causing audio-only downloads).
  const response = await undiciFetch(videoUrl, {
    headers: DOWNLOAD_HEADERS,
    signal:  AbortSignal.timeout(60_000),
  });
  if (!response.ok) {
    throw new Error(`Download falhou: HTTP ${response.status} — ${videoUrl}`);
  }
  const buf = Buffer.from(await response.arrayBuffer());
  if (buf.byteLength < 1024) {
    throw new Error(`Arquivo muito pequeno para ser um vídeo válido: ${buf.byteLength} bytes`);
  }
  console.log(`[videoSanitizer] download OK: ${(buf.byteLength / 1024).toFixed(0)} KB`);
  fs.writeFileSync(destPath, buf);
}

async function runSanitize(inputPath: string, outputPath: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    ffmpeg(inputPath)
      .outputOptions(buildSanitizeOptions())
      .output(outputPath)
      .on("end",   () => resolve())
      .on("error", (err: Error) => reject(new Error(`FFmpeg: ${err.message}`)))
      .run();
  });
}

function buildStoragePath(baseName: string, uid: string): string {
  const safe = baseName.replace(/[^a-z0-9_-]/gi, "_").slice(0, 60);
  return `videos/${safe}_${Date.now()}_${uid.slice(0, 8)}.mp4`;
}

/**
 * Sanitiza vídeo para salvar na Biblioteca.
 * Equivalente ao antigo sanitizeAndHashBust.
 */
export async function sanitizeForLibrary(
  videoUrl: string,
  baseName: string
): Promise<SanitizeResult> {
  const tmpDir      = os.tmpdir();
  const uid         = crypto.randomUUID();
  const inputPath   = path.join(tmpDir, `asc_in_${uid}.mp4`);
  const outputPath  = path.join(tmpDir, `asc_out_${uid}.mp4`);

  await downloadVideo(videoUrl, inputPath);
  await runSanitize(inputPath, outputPath);

  const stats       = fs.statSync(outputPath);
  const storagePath = buildStoragePath(baseName, uid);
  const cleanup     = () => {
    for (const p of [inputPath, outputPath]) {
      try { fs.unlinkSync(p); } catch { /* ok */ }
    }
  };

  return { outputPath, storagePath, fileSize: stats.size, cleanup };
}

/**
 * Sanitiza vídeo para download local no dispositivo do usuário.
 * Equivalente ao antigo sanitizeDoublePass (agora single-pass idêntico ao de Library).
 */
export async function sanitizeForDownload(
  videoUrl: string,
  baseName: string
): Promise<SanitizeResult> {
  return sanitizeForLibrary(videoUrl, baseName);
}

// ── Aliases para compatibilidade com imports existentes ──────────────────────
export const sanitizeAndHashBust  = sanitizeForLibrary;
export const sanitizeDoublePass   = sanitizeForDownload;
