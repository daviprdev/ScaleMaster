/**
 * videoSanitizer.ts — Anti-duplicate fingerprint pipeline for Instagram Reels
 *
 * Both exported functions produce a file that is:
 *   • Visually identical to the source (noise below human detection threshold)
 *   • Mathematically unique: different MD5, SHA-256, and perceptual hash on every run
 *   • Metadata-free: no origin URL, encoder info, GPS, timestamps, or EXIF
 *
 * Hash-busting technique: `noise=alls=1:allf=u+t`
 *   Adds 1 luma unit (0.4 % of 255) of temporally-varying uniform random noise.
 *   Because the noise is different for every pixel on every frame, it defeats
 *   both exact-match (MD5/SHA-256) and perceptual (pHash/dHash) deduplication —
 *   far more effective than a uniform brightness or saturation shift, which
 *   perceptual hash algorithms can easily normalise out.
 *
 * Audio: always stream-copied (-c:a copy). No re-encode, no quality loss.
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
 * Single-pass sanitization used when saving Inspirations to the Library.
 *
 * Pipeline:
 *   download → libx264 CRF 18 + noise filter + audio copy + strip metadata + UUID salt
 *
 * CRF 18 is visually lossless for virtually all source material. The 1-LSB
 * noise filter changes every pixel independently per frame, producing a file
 * that is structurally and mathematically unique while remaining
 * perceptually identical to the original.
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

  // ── 2. Re-encode with noise + strip metadata ──────────────────────────────
  const hashSalt = crypto.randomUUID();

  await new Promise<void>((resolve, reject) => {
    ffmpeg(inputPath)
      .videoCodec("libx264")
      .outputOptions([
        "-crf",          "18",
        "-preset",       "fast",
        "-profile:v",    "high",
        // Temporal noise: 1 luma unit per pixel per frame — imperceptible but
        // produces a unique perceptual hash on every processing event.
        "-vf",           "noise=alls=1:allf=u+t",
        // Stream-copy audio to preserve original quality without re-encode.
        "-c:a",          "copy",
        "-map_metadata", "-1",
        "-metadata",     `comment=${hashSalt}`,
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
 * Two-pass sanitization used for local device downloads.
 *
 * Pass 1 — Metadata strip (stream copy, fast)
 *   Removes every metadata atom from the source container: EXIF, GPS, origin
 *   URL, encoder fingerprint, creation timestamps. Stream copy means this is
 *   near-instant regardless of file size.
 *
 * Pass 2 — Fingerprint mutation (re-encode, quality pass)
 *   libx264 CRF 20 (visually lossless), fast preset, `noise=alls=1:allf=u+t`.
 *   The temporal noise makes every output pixel unique → different MD5, SHA-256,
 *   and perceptual hash. UUID injection + `-fflags +bitexact` suppress any
 *   remaining FFmpeg muxer fingerprint atoms.
 *   Audio is stream-copied from the already-clean pass-1 output.
 */
export async function sanitizeDoublePass(
  videoUrl: string,
  baseName: string
): Promise<SanitizeResult> {
  const tmpDir = os.tmpdir();
  const uid = crypto.randomUUID();
  const inputPath  = path.join(tmpDir, `asc_in_${uid}.mp4`);
  const pass1Path  = path.join(tmpDir, `asc_p1_${uid}.mp4`);
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

  // ── 2. Pass 1 — strip ALL metadata (stream copy, fast) ───────────────────
  await new Promise<void>((resolve, reject) => {
    ffmpeg(inputPath)
      .outputOptions([
        "-map_metadata", "-1",
        "-c:v", "copy",
        "-c:a", "copy",
      ])
      .output(pass1Path)
      .on("end", () => resolve())
      .on("error", (err: Error) => reject(new Error(`FFmpeg pass 1: ${err.message}`)))
      .run();
  });

  // ── 3. Pass 2 — re-encode with noise + UUID + bitexact ───────────────────
  const hashSalt = crypto.randomUUID();

  await new Promise<void>((resolve, reject) => {
    ffmpeg(pass1Path)
      .videoCodec("libx264")
      .outputOptions([
        "-crf",          "20",
        "-preset",       "fast",
        "-profile:v",    "high",
        // Per-pixel, per-frame temporal noise → unique perceptual hash every run.
        "-vf",           "noise=alls=1:allf=u+t",
        // Audio: stream-copy from the clean pass-1 output (zero quality loss).
        "-c:a",          "copy",
        "-map_metadata", "-1",
        "-metadata",     `comment=${hashSalt}`,
        // Suppress FFmpeg's own muxer/encoder fingerprint atoms.
        "-fflags",       "+bitexact",
        "-movflags",     "+faststart",
      ])
      .output(outputPath)
      .on("end", () => resolve())
      .on("error", (err: Error) => reject(new Error(`FFmpeg pass 2: ${err.message}`)))
      .run();
  });

  // ── 4. Build storage path ─────────────────────────────────────────────────
  const stats = fs.statSync(outputPath);
  const timestamp = Date.now();
  const safe = baseName.replace(/[^a-z0-9_-]/gi, "_").slice(0, 60);
  const storagePath = `videos/${safe}_${timestamp}_${uid.slice(0, 8)}.mp4`;

  const cleanup = () => {
    for (const p of [inputPath, pass1Path, outputPath]) {
      try { fs.unlinkSync(p); } catch { /* already removed */ }
    }
  };

  return { outputPath, storagePath, fileSize: stats.size, cleanup };
}
