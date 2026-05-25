/**
 * videoSanitizer.ts — Aggressive multi-layer metadata sanitization for Instagram Reels
 *
 * Both exported functions produce a file that is:
 *   • Codec-identical to the source: stream copy preserves the original H.264/AAC
 *     profile so Meta API integrity checks pass without triggering bot detection
 *   • Deep-wiped: metadata cleared at every container layer —
 *     global (-map_metadata -1), video stream (-map_metadata:s:v -1),
 *     audio stream (-map_metadata:s:a -1), chapters (-map_chapters -1)
 *   • Freshly born: creation_time=now makes the file appear generated at upload time
 *   • Container-unique: UUID in comment atom + -fflags +bitexact
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
 * Single-pass sanitization used when saving Inspirations to the Library.
 *
 * Pipeline:
 *   download → stream copy + strip metadata + UUID salt + bitexact
 *
 * Stream copy preserves the original codec profile (H.264 + AAC) exactly as
 * downloaded from Instagram — required for Meta API integrity checks to pass.
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

  // ── 2. Deep wipe + stream copy + UUID salt + fresh creation_time ─────────
  const hashSalt = crypto.randomUUID();

  await new Promise<void>((resolve, reject) => {
    ffmpeg(inputPath)
      .outputOptions([
        "-c:v",              "copy",
        "-c:a",              "copy",
        // Deep wipe — clears metadata at every container layer
        "-map_metadata",     "-1",
        "-map_metadata:s:v", "-1",
        "-map_metadata:s:a", "-1",
        "-map_chapters",     "-1",
        // Inject fresh identity so the file appears newly generated
        "-metadata",         `comment=${hashSalt}`,
        "-metadata",         "creation_time=now",
        "-fflags",           "+bitexact",
        "-movflags",         "+faststart",
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
 * Pass 1 — Metadata strip (stream copy)
 *   Removes every metadata atom from the source container: EXIF, GPS, origin
 *   URL, encoder fingerprint, creation timestamps.
 *
 * Pass 2 — UUID injection + bitexact (stream copy)
 *   Injects a unique UUID comment + -fflags +bitexact to suppress FFmpeg
 *   muxer fingerprint atoms. Near-instant for any file size.
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

  // ── 2. Pass 1 — deep wipe: strip ALL metadata at every container layer ───
  await new Promise<void>((resolve, reject) => {
    ffmpeg(inputPath)
      .outputOptions([
        "-c:v",              "copy",
        "-c:a",              "copy",
        "-map_metadata",     "-1",
        "-map_metadata:s:v", "-1",
        "-map_metadata:s:a", "-1",
        "-map_chapters",     "-1",
      ])
      .output(pass1Path)
      .on("end", () => resolve())
      .on("error", (err: Error) => reject(new Error(`FFmpeg pass 1: ${err.message}`)))
      .run();
  });

  // ── 3. Pass 2 — UUID + fresh creation_time + bitexact (stream copy) ─────
  const hashSalt = crypto.randomUUID();

  await new Promise<void>((resolve, reject) => {
    ffmpeg(pass1Path)
      .outputOptions([
        "-c:v",              "copy",
        "-c:a",              "copy",
        "-map_metadata",     "-1",
        "-map_metadata:s:v", "-1",
        "-map_metadata:s:a", "-1",
        "-map_chapters",     "-1",
        "-metadata",         `comment=${hashSalt}`,
        "-metadata",         "creation_time=now",
        "-fflags",           "+bitexact",
        "-movflags",         "+faststart",
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
