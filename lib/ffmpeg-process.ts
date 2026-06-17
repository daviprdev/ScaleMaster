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
 * Downloads a video and re-packages it via pure stream extraction.
 *
 * Pipeline (Pure Extraction):
 *   -map 0:v:0          — extract ONLY the first video track; discards all data
 *                          streams, SEI custom atoms and telemetry tracks embedded
 *                          by source CDNs (Instagram, TikTok, etc.)
 *   -map 0:a:0?         — extract ONLY the first audio track (optional — ? flag
 *                          prevents failure when the source has no audio)
 *   -c:v copy -c:a copy — stream copy preserves 100% original codec profile
 *                          (H.264/AAC); required for Meta API integrity checks
 *   -map_metadata -1    — strips all global container metadata (EXIF, GPS, encoder)
 *   -map_chapters -1    — removes chapter markers
 *   -movflags +faststart — moves moov atom to front for progressive web playback
 *   -f mp4              — forces strict MP4 container (no non-standard atom types)
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

  const stats = fs.statSync(outputPath);

  const cleanup = () => {
    for (const p of [inputPath, outputPath]) {
      try { fs.unlinkSync(p); } catch { /* ok */ }
    }
  };

  return { outputPath, fileSize: stats.size, cleanup };
}
