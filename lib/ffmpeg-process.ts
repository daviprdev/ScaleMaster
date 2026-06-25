import ffmpeg from "fluent-ffmpeg";
import ffmpegInstaller from "@ffmpeg-installer/ffmpeg";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import * as crypto from "crypto";
import { fetch as undiciFetch } from "undici";

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
 *   -map 0:v:0                         — first video track only; discards data streams
 *   -map 0:a:0?                        — first audio track only (? = optional)
 *   -c:v copy -c:a copy                — stream copy; zero re-encoding, 100% quality
 *   -bsf:v filter_units=remove_types=6 — strips all SEI NAL units (H.264 NAL unit type 6).
 *                                        SEI NAL units carry SEI payload types:
 *                                          payload 5 (user_data_unregistered): CDN tracking UUIDs
 *                                          payload 4 (user_data_registered):   Instagram/TikTok fingerprints
 *                                        NAL unit type 5 = IDR keyframes — must NOT be removed.
 *                                        These survive -map_metadata because they are in the
 *                                        video bitstream, not in MP4 container atoms.
 *   -map_metadata -1                   — strips container-level metadata (EXIF, GPS, encoder)
 *   -map_chapters -1                   — removes chapter markers
 *   -movflags +faststart               — moov atom at front for progressive web playback
 *   -f mp4                             — strict MP4 container
 */
export async function downloadAndStripMetadata(
  videoUrl: string
): Promise<ProcessResult> {
  const tmpDir = os.tmpdir();
  const uid = crypto.randomUUID();
  const inputPath = path.join(tmpDir, `nexus_in_${uid}.mp4`);
  const outputPath = path.join(tmpDir, `nexus_out_${uid}.mp4`);

  // undici bypasses Next.js 15's patched global fetch (which strips dispatcher
  // and can corrupt binary responses from Supabase Storage CDN redirects).
  const response = await undiciFetch(videoUrl, {
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) {
    throw new Error(`Falha ao baixar vídeo: HTTP ${response.status}`);
  }
  const buffer = await response.arrayBuffer();
  if (buffer.byteLength < 1024) {
    throw new Error(`Arquivo muito pequeno para ser um vídeo válido: ${buffer.byteLength} bytes`);
  }
  console.log(`[ffmpeg-process] Download OK: ${(buffer.byteLength / 1024).toFixed(0)} KB de ${videoUrl.split("/").pop()}`);
  fs.writeFileSync(inputPath, Buffer.from(buffer));

  await new Promise<void>((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const cmd = ffmpeg(inputPath)
      .outputOptions([
        "-map 0:v:0",
        "-map 0:a:0?",
        "-c:v",          "copy",
        "-c:a",          "copy",
        "-bsf:v",        "filter_units=remove_types=6",
        "-map_metadata", "-1",
        "-map_chapters", "-1",
        "-movflags",     "+faststart",
        "-f",            "mp4",
      ])
      .output(outputPath)
      .on("end",   () => { clearTimeout(timer); resolve(); })
      .on("error", (err: Error) => { clearTimeout(timer); reject(new Error(`FFmpeg: ${err.message}`)); });
    cmd.run();
    timer = setTimeout(() => {
      try { (cmd as any).kill("SIGKILL"); } catch { /* ok */ }
      reject(new Error("FFmpeg strip timeout (>15s)"));
    }, 15_000);
  });

  const stats = fs.statSync(outputPath);

  const cleanup = () => {
    for (const p of [inputPath, outputPath]) {
      try { fs.unlinkSync(p); } catch { /* ok */ }
    }
  };

  return { outputPath, fileSize: stats.size, cleanup };
}
