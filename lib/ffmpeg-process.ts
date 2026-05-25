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
 * Downloads a video and performs aggressive multi-layer metadata stripping via stream copy.
 * Uses -c:v copy / -c:a copy to preserve the original codec profile exactly —
 * required for Meta API integrity checks. Clears metadata at every container level
 * (global, video stream, audio stream, chapters) and injects a fresh creation_time
 * so the file appears newly generated rather than a copy.
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

  const stats = fs.statSync(outputPath);

  const cleanup = () => {
    for (const p of [inputPath, outputPath]) {
      try { fs.unlinkSync(p); } catch { /* ok */ }
    }
  };

  return { outputPath, fileSize: stats.size, cleanup };
}
