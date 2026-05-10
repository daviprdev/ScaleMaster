import ffmpeg from "fluent-ffmpeg";
import ffmpegInstaller from "@ffmpeg-installer/ffmpeg";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import * as crypto from "crypto";

// Aponta o fluent-ffmpeg para o binário do @ffmpeg-installer
ffmpeg.setFfmpegPath(ffmpegInstaller.path);

export interface ProcessResult {
  outputPath: string;
  fileSize: number;
  cleanup: () => void;
}

/**
 * Baixa um vídeo de uma URL e remove todos os metadados via FFmpeg.
 * Streams de vídeo e áudio são copiados sem re-encoding (rápido).
 *
 * Comando equivalente:
 *   ffmpeg -i input.mp4 -map_metadata -1 -c:v copy -c:a copy output.mp4
 */
export async function downloadAndStripMetadata(
  videoUrl: string
): Promise<ProcessResult> {
  const tmpDir = os.tmpdir();
  const uid = crypto.randomUUID();
  const inputPath = path.join(tmpDir, `nexus_in_${uid}.mp4`);
  const outputPath = path.join(tmpDir, `nexus_out_${uid}.mp4`);

  // 1. Baixa o vídeo para o disco temporário
  const response = await fetch(videoUrl);
  if (!response.ok) {
    throw new Error(`Falha ao baixar vídeo: HTTP ${response.status}`);
  }

  const buffer = await response.arrayBuffer();
  fs.writeFileSync(inputPath, Buffer.from(buffer));

  // 2. Processa com FFmpeg (strip de metadados)
  await new Promise<void>((resolve, reject) => {
    ffmpeg(inputPath)
      .outputOptions([
        "-map_metadata", "-1",   // Remove todos os metadados
        "-c:v", "copy",           // Copia stream de vídeo sem re-encode
        "-c:a", "copy",           // Copia stream de áudio sem re-encode
      ])
      .output(outputPath)
      .on("end", () => resolve())
      .on("error", (err: Error) => reject(new Error(`FFmpeg: ${err.message}`)))
      .run();
  });

  const stats = fs.statSync(outputPath);

  // Função de limpeza — chamar após o upload
  const cleanup = () => {
    for (const p of [inputPath, outputPath]) {
      try { fs.unlinkSync(p); } catch { /* arquivo pode não existir */ }
    }
  };

  return { outputPath, fileSize: stats.size, cleanup };
}
