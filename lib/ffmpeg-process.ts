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
 *   -map 0:v:0                      — first video track only; discards data streams
 *   -map 0:a:0?                     — first audio track only (? = optional)
 *   -c:v copy -c:a copy             — stream copy; zero re-encoding, 100% quality
 *   -bsf:v filter_units=remove_types=6  — strips SEI NAL units (H.264 type 6):
 *                                     UUID tracking, creator ID, CDN fingerprints
 *                                     embedded by Instagram/TikTok inside the bitstream.
 *                                     Survives -map_metadata because it lives inside
 *                                     the video bitstream, not in MP4 container atoms.
 *   -map_metadata -1                — strips container-level metadata (EXIF, GPS, encoder)
 *   -map_chapters -1                — removes chapter markers
 *   -movflags +faststart            — moov atom at front for progressive web playback
 *   -f mp4                          — strict MP4 container (no non-standard atom types)
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
        "-bsf:v",        "filter_units=remove_types=6",  // strip SEI NAL units (H.264 type 6): Instagram UUID tracking, creator ID, CDN fingerprints
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
