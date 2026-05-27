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
 * Downloads a video and re-packages it via stream copy.
 *
 * Pipeline: -c:v copy -c:a copy -map_metadata -1 -movflags +faststart
 *
 * Preserves the original H.264/AAC codec profile (required for Meta API integrity
 * checks). Strips all source container metadata. No artificial metadata is injected
 * — the re-packaging alone (different moov atom ordering/muxer timestamps) naturally
 * differentiates the file without creating a programmatic fingerprint.
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

  const stats = fs.statSync(outputPath);

  const cleanup = () => {
    for (const p of [inputPath, outputPath]) {
      try { fs.unlinkSync(p); } catch { /* ok */ }
    }
  };

  return { outputPath, fileSize: stats.size, cleanup };
}
