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
 * Downloads a video and processes it with two objectives:
 *
 * 1. High quality re-encode: libx264 CRF 18 (visually lossless), fast preset,
 *    high profile, AAC 192k — avoids the quality loss of stream copy and
 *    produces a file optimised for Instagram's ingest pipeline.
 *
 * 2. Unique signature: strips ALL metadata (-map_metadata -1) and applies an
 *    imperceptible visual filter (eq=brightness=0.01:saturation=1.01) so every
 *    output file carries a different MD5 + perceptual hash — defeats Instagram's
 *    exact-match and near-duplicate deduplication that suppresses reach.
 */
export async function downloadAndStripMetadata(
  videoUrl: string
): Promise<ProcessResult> {
  const tmpDir = os.tmpdir();
  const uid = crypto.randomUUID();
  const inputPath = path.join(tmpDir, `nexus_in_${uid}.mp4`);
  const outputPath = path.join(tmpDir, `nexus_out_${uid}.mp4`);

  // Allow up to 60s for the download — large Reels can be >100 MB
  const response = await fetch(videoUrl, {
    signal: AbortSignal.timeout(60_000),
  });
  if (!response.ok) {
    throw new Error(`Falha ao baixar vídeo: HTTP ${response.status}`);
  }
  const buffer = await response.arrayBuffer();
  fs.writeFileSync(inputPath, Buffer.from(buffer));

  await new Promise<void>((resolve, reject) => {
    ffmpeg(inputPath)
      .videoCodec("libx264")
      .outputOptions([
        "-crf",        "18",
        "-preset",     "fast",
        "-profile:v",  "high",
        // Imperceptible brightness/saturation tweak — changes every pixel's
        // value by < 1 LSB visually, but produces a completely different hash.
        "-vf",         "eq=brightness=0.01:saturation=1.01",
        "-c:a",        "aac",
        "-b:a",        "192k",
        "-map_metadata", "-1",
        // Place moov atom at front so the video is streamable before full DL
        "-movflags",   "+faststart",
      ])
      .output(outputPath)
      .on("stderr", (line: string) => {
        // FFmpeg writes progress + warnings to stderr; log at debug level
        console.log(`[ffmpeg] ${line}`);
      })
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
