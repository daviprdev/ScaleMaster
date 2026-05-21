/**
 * videoSanitizer.ts
 *
 * Two-level anti-shadowban sanitization pipeline for downloaded Reels:
 *
 * Level 1 — Metadata Stripping
 *   Removes 100% of original metadata tags: EXIF, GPS, origin URL, software
 *   creator, timestamps, encoder info. Achieved via FFmpeg `-map_metadata -1`.
 *
 * Level 2 — Hash Busting
 *   Injects a cryptographically-random UUID as a comment tag so that the
 *   output file's MD5/SHA-256 signature is unique per processing event.
 *   Instagram's duplicate-detection heuristic compares file hashes —
 *   a unique hash prevents the platform from recognising the file as a
 *   previously-seen clip.
 *
 * Stream copy (-c:v copy -c:a copy) means no re-encode: fast execution and
 * zero quality loss.
 *
 * FFmpeg equivalent:
 *   ffmpeg -i input.mp4 \
 *     -map_metadata -1         \
 *     -metadata comment=<UUID> \
 *     -c:v copy -c:a copy      \
 *     output.mp4
 */

import ffmpeg from "fluent-ffmpeg";
import ffmpegInstaller from "@ffmpeg-installer/ffmpeg";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import * as crypto from "crypto";

ffmpeg.setFfmpegPath(ffmpegInstaller.path);

export interface SanitizeResult {
  /** Absolute path to the sanitized output file in /tmp */
  outputPath: string;
  /** Relative storage path to use when uploading to Supabase Storage */
  storagePath: string;
  /** File size in bytes of the sanitized output */
  fileSize: number;
  /** Call this after uploading to remove temp files */
  cleanup: () => void;
}

// Headers used for downloading from Instagram/Apify CDNs
const DOWNLOAD_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (iPhone; CPU iPhone OS 16_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.5 Mobile/15E148 Safari/604.1",
  Referer: "https://www.instagram.com/",
  Origin: "https://www.instagram.com",
  Accept: "video/mp4,video/webm,*/*;q=0.8",
  Connection: "keep-alive",
};

/**
 * Downloads a video from `videoUrl`, strips all metadata (Level 1), and
 * injects a per-run UUID comment to mutate the file hash (Level 2).
 *
 * @param videoUrl  - Direct CDN URL of the source video
 * @param baseName  - Human-readable base name used to build the storage path
 *                    (will be sanitized to `[a-z0-9_-]` characters)
 */
export async function sanitizeAndHashBust(
  videoUrl: string,
  baseName: string
): Promise<SanitizeResult> {
  const tmpDir = os.tmpdir();
  const uid = crypto.randomUUID();
  const inputPath = path.join(tmpDir, `asc_in_${uid}.mp4`);
  const outputPath = path.join(tmpDir, `asc_out_${uid}.mp4`);

  // ── 1. Download to temporary file ─────────────────────────────────
  const response = await fetch(videoUrl, {
    headers: DOWNLOAD_HEADERS,
    signal: AbortSignal.timeout(60_000), // 60 s download timeout
  });
  if (!response.ok) {
    throw new Error(`Download falhou: HTTP ${response.status} — ${videoUrl}`);
  }
  const buffer = await response.arrayBuffer();
  fs.writeFileSync(inputPath, Buffer.from(buffer));

  // ── 2. Generate unique hash salt (Level 2) ────────────────────────
  // A fresh UUID injected as `comment` guarantees a different file hash
  // for every single processing event, even if the source video is identical.
  const hashSalt = crypto.randomUUID();

  // ── 3. FFmpeg: strip + hash-bust ──────────────────────────────────
  await new Promise<void>((resolve, reject) => {
    ffmpeg(inputPath)
      .outputOptions([
        // Level 1 — strip ALL metadata from input streams and container
        "-map_metadata", "-1",
        // Level 2 — inject opaque UUID; makes the output hash unique
        "-metadata", `comment=${hashSalt}`,
        // Stream copy: no re-encode → fast, lossless
        "-c:v", "copy",
        "-c:a", "copy",
      ])
      .output(outputPath)
      .on("end", () => resolve())
      .on("error", (err: Error) => reject(new Error(`FFmpeg: ${err.message}`)))
      .run();
  });

  // ── 4. Build storage path ─────────────────────────────────────────
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
 * Two-pass sanitization for local device downloads.
 *
 * Pass 1 — Complete strip
 *   `-map_metadata -1` removes every metadata atom from the original file
 *   (container-level, stream-level, EXIF, GPS, XMP, encoder info, timestamps).
 *   Stream copy preserves quality at near-zero CPU cost.
 *
 * Pass 2 — Hash mutation + fingerprint suppression
 *   `-map_metadata -1` again on the already-clean pass-1 output (double guarantee).
 *   `-metadata comment=<UUID>` injects a unique salt → unique file hash per download.
 *   `-fflags +bitexact -flags:v +bitexact -flags:a +bitexact` suppresses FFmpeg's
 *   own encoder/muxer fingerprint atoms that would otherwise be written during remux.
 *
 * The result is a file with:
 *   • Zero original metadata
 *   • No FFmpeg encoder fingerprint
 *   • A unique SHA-256 / MD5 hash per download event
 */
export async function sanitizeDoublePass(
  videoUrl: string,
  baseName: string
): Promise<SanitizeResult> {
  const tmpDir = os.tmpdir();
  const uid = crypto.randomUUID();
  const inputPath = path.join(tmpDir, `asc_in_${uid}.mp4`);
  const pass1Path  = path.join(tmpDir, `asc_p1_${uid}.mp4`);
  const outputPath = path.join(tmpDir, `asc_out_${uid}.mp4`);

  // ── 1. Download ───────────────────────────────────────────────────
  const response = await fetch(videoUrl, {
    headers: DOWNLOAD_HEADERS,
    signal: AbortSignal.timeout(60_000),
  });
  if (!response.ok) {
    throw new Error(`Download falhou: HTTP ${response.status} — ${videoUrl}`);
  }
  const buffer = await response.arrayBuffer();
  fs.writeFileSync(inputPath, Buffer.from(buffer));

  // ── 2. Pass 1 — strip ALL original metadata ───────────────────────
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

  // ── 3. Pass 2 — UUID injection + bitexact (no encoder fingerprint) ─
  const hashSalt = crypto.randomUUID();
  await new Promise<void>((resolve, reject) => {
    ffmpeg(pass1Path)
      .outputOptions([
        "-map_metadata", "-1",
        "-metadata", `comment=${hashSalt}`,
        // Prevents FFmpeg from writing its own encoder/muxer fingerprint atoms
        "-fflags", "+bitexact",
        "-flags:v", "+bitexact",
        "-flags:a", "+bitexact",
        "-c:v", "copy",
        "-c:a", "copy",
      ])
      .output(outputPath)
      .on("end", () => resolve())
      .on("error", (err: Error) => reject(new Error(`FFmpeg pass 2: ${err.message}`)))
      .run();
  });

  // ── 4. Build storage path ─────────────────────────────────────────
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
