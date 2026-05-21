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
    signal: AbortSignal.timeout(30_000), // 30 s download timeout
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
