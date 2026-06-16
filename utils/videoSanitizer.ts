/**
 * videoSanitizer.ts — Pure Extraction pipeline for Instagram Reels
 *
 * Extracts STRICTLY the primary video and primary audio tracks, discarding
 * all other data streams, hidden subtitles and telemetry tracks embedded by
 * source CDNs (Instagram, TikTok, etc.). Packages into a clean MP4.
 *
 *   -map 0:v:0          — first video track only; discards data streams / SEI atoms
 *   -map 0:a:0?         — first audio track only, if present (? = optional)
 *   -c:v copy -c:a copy — stream copy keeps 100% original H.264/AAC profile
 *   -map_metadata -1    — strips all global container metadata (EXIF, GPS, encoder)
 *   -map_chapters -1    — removes chapter markers
 *   -movflags +faststart — moov atom at front for progressive web playback
 *   -f mp4              — strict MP4 container (no non-standard atom types)
 */

import ffmpeg from "fluent-ffmpeg";
import ffmpegStatic from "ffmpeg-static";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import * as crypto from "crypto";

ffmpeg.setFfmpegPath(ffmpegStatic as string);

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
        "-map 0:v:0",    // pure video extraction — first track only, no data streams
        "-map 0:a:0?",   // pure audio extraction — first track only (optional)
        "-c:v",          "copy",
        "-c:a",          "copy",
        "-map_metadata", "-1",
        "-map_chapters", "-1",
        "-movflags",     "+faststart",
        "-f",            "mp4",
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
        "-map 0:v:0",    // pure video extraction — first track only, no data streams
        "-map 0:a:0?",   // pure audio extraction — first track only (optional)
        "-c:v",          "copy",
        "-c:a",          "copy",
        "-map_metadata", "-1",
        "-map_chapters", "-1",
        "-movflags",     "+faststart",
        "-f",            "mp4",
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
