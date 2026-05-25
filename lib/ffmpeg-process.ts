import ffmpeg from "fluent-ffmpeg";
import ffmpegInstaller from "@ffmpeg-installer/ffmpeg";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import * as crypto from "crypto";

ffmpeg.setFfmpegPath(ffmpegInstaller.path);

export interface ProcessResult {
  outputPath: string;
  fileSize: number;
  cleanup: () => void;
}

/**
 * Downloads a video and processes it through a high-quality, fingerprint-busting pipeline:
 *
 * 1. Quality: libx264 CRF 18 (visually lossless), fast preset, high profile.
 *    Audio is stream-copied (-c:a copy) — zero quality loss, no re-encode overhead.
 *
 * 2. Unique fingerprint: strips ALL metadata (-map_metadata -1) and applies
 *    `noise=alls=1:allf=u+t` — 1 luma-unit of temporally-varying random noise.
 *    This is below the human detection threshold (~0.4% per pixel) but produces
 *    a completely different MD5, SHA-256, and perceptual hash on every run.
 *    Unlike a uniform brightness/saturation shift, temporal noise varies per
 *    frame and per pixel, defeating both exact-match and pHash deduplication.
 */
export async function downloadAndStripMetadata(
  videoUrl: string
): Promise<ProcessResult> {
  const tmpDir = os.tmpdir();
  const uid = crypto.randomUUID();
  const inputPath = path.join(tmpDir, `nexus_in_${uid}.mp4`);
  const outputPath = path.join(tmpDir, `nexus_out_${uid}.mp4`);

  const response = await fetch(videoUrl, {
    signal: AbortSignal.timeout(60_000),
  });
  if (!response.ok) {
    throw new Error(`Falha ao baixar vídeo: HTTP ${response.status}`);
  }
  const buffer = await response.arrayBuffer();
  fs.writeFileSync(inputPath, Buffer.from(buffer));

  const hashSalt = crypto.randomUUID();

  await new Promise<void>((resolve, reject) => {
    ffmpeg(inputPath)
      .videoCodec("libx264")
      .outputOptions([
        "-crf",          "18",
        "-preset",       "fast",
        "-profile:v",    "high",
        // 1 luma-unit temporal noise: imperceptible to the eye, unique per frame.
        // Defeats both MD5 and perceptual-hash duplicate detection.
        "-vf",           "noise=alls=1:allf=u+t",
        // Stream-copy audio — preserves original quality with zero re-encode cost.
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

  const stats = fs.statSync(outputPath);

  const cleanup = () => {
    for (const p of [inputPath, outputPath]) {
      try { fs.unlinkSync(p); } catch { /* ok */ }
    }
  };

  return { outputPath, fileSize: stats.size, cleanup };
}
