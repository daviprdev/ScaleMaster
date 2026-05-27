/**
 * videoSanitizer.ts — Vanilla stream-copy pipeline for Instagram Reels
 *
 * Pipeline: stream copy + metadata strip + faststart web optimization.
 *
 *   -c:v copy        — preserves original H.264/AAC codec profile exactly
 *   -c:a copy        — required for Meta API integrity checks to pass
 *   -map_metadata -1 — strips all source container metadata (EXIF, GPS, encoder tags)
 *   -movflags +faststart — moves moov atom to front for progressive web playback
 *
 * No artificial metadata is injected (no UUID comment, no creation_time, no bitexact).
 * The re-packaging itself (different atom ordering/muxer timestamps) naturally
 * differentiates the output from the source without creating a programmatic fingerprint.
 *
 * Re-encoding (libx264 / noise filters) is intentionally avoided — it alters
 * the codec profile in ways the Meta API flags as synthetic/spam content.
 */

import ffmpeg from "fluent-ffmpeg";
import ffmpegInstaller from "@ffmpeg-installer/ffmpeg";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import * as crypto from "crypto";

ffmpeg.setFfmpegPath(ffmpegInstaller.path);

export interface SanitizeResult {
  /** Absolute path to the processed output file in /tmp */
  outputPath: string;
  /** Relative storage path to use when uploading to Supabase Storage */
  storagePath: string;
  /** File size in bytes of the processed output */
  fileSize: number;
  /** Call this after uploading to remove all temp files */
  cleanup: () => void;
}

const DOWNLOAD_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (iPhone; CPU iPhone OS 16_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.5 Mobile/15E148 Safari/604.1",
  Referer: "https://www.instagram.com/",
  Origin: "https://www.instagram.com",
  Accept: "video/mp4,video/webm,*/*;q=0.8",
  Connection: "keep-alive",
};

/**
 * Vanilla sanitization used when saving Inspirations to the Library.
 *
 * Pipeline: download → stream copy + strip metadata + faststart
 */
export async function sanitizeAndHashBust(
  videoUrl: string,
  baseName: string
): Promise<SanitizeResult> {
  const tmpDir = os.tmpdir();
  const uid = crypto.randomUUID();
  const inputPath  = path.join(tmpDir, `asc_in_${uid}.mp4`);
  const outputPath = path.join(tmpDir, `asc_out_${uid}.mp4`);

  // ── 1. Download ───────────────────────────────────────────────────────────
  const response = await fetch(videoUrl, {
    headers: DOWNLOAD_HEADERS,
    signal: AbortSignal.timeout(60_000),
  });
  if (!response.ok) {
    throw new Error(`Download falhou: HTTP ${response.status} — ${videoUrl}`);
  }
  const buffer = await response.arrayBuffer();
  fs.writeFileSync(inputPath, Buffer.from(buffer));

  // ── 2. Stream copy + metadata strip + faststart ───────────────────────────
  await new Promise<void>((resolve, reject) => {
    ffmpeg(inputPath)
      .outputOptions([
        "-c:v",          "copy",
        "-c:a",          "copy",
        "-map_metadata", "-1",
        "-movflags",     "+faststart",
      ])
      .output(outputPath)
      .on("end", () => resolve())
      .on("error", (err: Error) => reject(new Error(`FFmpeg: ${err.message}`)))
      .run();
  });

  // ── 3. Build storage path ─────────────────────────────────────────────────
  const stats = fs.statSync(outputPath);
  const timestamp = Date.now();
  const safe = baseName.replace(/[^a-z0-9_-]/gi, "_").slice(0, 60);
  const storagePath = `videos/${safe}_${timestamp}_${uid.slice(0, 8)}.mp4`;

  const cleanup = () => {
    for (const p of [inputPath, outputPath]) {
      try { fs.unlinkSync(p); } catch { /* already removed or never created */ }
    }
  };

  return { outputPath, storagePath, fileSize: stats.size, cleanup };
}

/**
 * Single-pass sanitization used for local device downloads.
 *
 * Pipeline: download → stream copy + strip metadata + faststart
 *
 * Previously two passes; collapsed to one since the second pass only existed
 * to inject a UUID comment (now removed to avoid programmatic fingerprinting).
 */
export async function sanitizeDoublePass(
  videoUrl: string,
  baseName: string
): Promise<SanitizeResult> {
  const tmpDir = os.tmpdir();
  const uid = crypto.randomUUID();
  const inputPath  = path.join(tmpDir, `asc_in_${uid}.mp4`);
  const outputPath = path.join(tmpDir, `asc_out_${uid}.mp4`);

  // ── 1. Download ───────────────────────────────────────────────────────────
  const response = await fetch(videoUrl, {
    headers: DOWNLOAD_HEADERS,
    signal: AbortSignal.timeout(60_000),
  });
  if (!response.ok) {
    throw new Error(`Download falhou: HTTP ${response.status} — ${videoUrl}`);
  }
  const buffer = await response.arrayBuffer();
  fs.writeFileSync(inputPath, Buffer.from(buffer));

  // ── 2. Stream copy + metadata strip + faststart ───────────────────────────
  await new Promise<void>((resolve, reject) => {
    ffmpeg(inputPath)
      .outputOptions([
        "-c:v",          "copy",
        "-c:a",          "copy",
        "-map_metadata", "-1",
        "-movflags",     "+faststart",
      ])
      .output(outputPath)
      .on("end", () => resolve())
      .on("error", (err: Error) => reject(new Error(`FFmpeg: ${err.message}`)))
      .run();
  });

  // ── 3. Build storage path ─────────────────────────────────────────────────
  const stats = fs.statSync(outputPath);
  const timestamp = Date.now();
  const safe = baseName.replace(/[^a-z0-9_-]/gi, "_").slice(0, 60);
  const storagePath = `videos/${safe}_${timestamp}_${uid.slice(0, 8)}.mp4`;

  const cleanup = () => {
    for (const p of [inputPath, outputPath]) {
      try { fs.unlinkSync(p); } catch { /* already removed */ }
    }
  };

  return { outputPath, storagePath, fileSize: stats.size, cleanup };
}
