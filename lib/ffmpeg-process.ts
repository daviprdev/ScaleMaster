/**
 * ffmpeg-process.ts — Ponto ÚNICO de limpeza de metadados do projeto.
 *
 * REGRA ARQUITETURAL (2026-09-06): nenhuma mídia é transformada na ENTRADA.
 * A Biblioteca guarda sempre o arquivo original. Esta função só roda quando o
 * usuário escolheu explicitamente `video_processing_mode = "clean_metadata"`
 * na configuração da publicação — ver lib/video-processing.ts.
 *
 * Pipeline (STREAM COPY — nunca re-encoda):
 *   -map 0:v:0          — primeira trilha de vídeo; descarta data streams
 *   -map 0:a:0?         — primeira trilha de áudio (opcional)
 *   -c:v copy -c:a copy — stream copy: bitstream H.264/AAC preservado bit a bit
 *   -map_metadata -1    — remove metadados do container (EXIF, GPS, encoder, título)
 *   -map_chapters -1    — remove chapter markers
 *   -movflags +faststart— move o átomo moov para o início do arquivo
 *   -f mp4              — container MP4 estrito
 *
 * O QUE **NÃO** FAZEMOS AQUI, e por quê:
 *
 *   • `-bsf:v filter_units=remove_types=6` (remoção de SEI NAL units)
 *     Removido em 2026-09-06. A justificativa histórica ("SEI = fingerprint
 *     secreto da Meta") nunca foi comprovada — era uma hipótese. O único fato
 *     de produção era: vídeos upados pelo browser davam ERROR/EXPIRED na Meta e
 *     passavam a funcionar depois do pipeline. Só que esse mesmo pipeline também
 *     aplica `+faststart`, e moov atom no fim do arquivo é uma causa conhecida e
 *     documentada de rejeição por parte de quem consome o vídeo por URL remota —
 *     explicação técnica concreta que não exige nenhuma hipótese sobre
 *     fingerprint. Como SEI type 6 também carrega dados legítimos (closed
 *     captions CEA-608/708, metadados HDR/mastering display, timecode, pic_timing
 *     usado por alguns decoders), remover às cegas pode degradar o arquivo sem
 *     benefício comprovado. Se um vídeo específico for rejeitado pela Meta e o
 *     remux com faststart não resolver, o filtro pode voltar como opção
 *     explícita — nunca como comportamento padrão.
 *
 *   • NAL type 5 (IDR keyframes) — NUNCA removido. Removê-lo destrói o vídeo.
 *
 *   • `-metadata creation_time=<data aleatória>` — removido. Injetar data falsa
 *     é transformação deliberada de conteúdo, não limpeza.
 *
 *   • Qualquer re-encode (libx264/CRF/noise/hue/eq/volume/atempo/setpts/
 *     unsharp/blur/crop/scale). Efeitos criativos têm pipeline próprio em
 *     lib/video-effects.ts e só rodam quando o usuário liga um efeito no Loop.
 */

import ffmpeg from "fluent-ffmpeg";
import ffmpegInstaller from "@ffmpeg-installer/ffmpeg";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import * as crypto from "crypto";
import { fetchMediaBytes } from "@/lib/media-ingest";

ffmpeg.setFfmpegPath(ffmpegInstaller.path);

export interface ProcessResult {
  outputPath: string;
  fileSize: number;
  cleanup: () => void;
}

/** Opções de saída da limpeza. Exportadas para auditoria/teste. */
export const CLEAN_METADATA_OUTPUT_OPTIONS: string[] = [
  "-map", "0:v:0",
  "-map", "0:a:0?",
  "-c:v", "copy",
  "-c:a", "copy",
  "-map_metadata", "-1",
  "-map_chapters", "-1",
  "-movflags", "+faststart",
  "-f", "mp4",
];

const DOWNLOAD_TIMEOUT_MS = 45_000;
const FFMPEG_TIMEOUT_MS = 60_000;

/**
 * Baixa `videoUrl` e devolve uma cópia limpa em /tmp (stream copy).
 * NÃO altera nada no banco nem no Storage — quem chama decide onde guardar.
 */
export async function downloadAndCleanMetadata(videoUrl: string): Promise<ProcessResult> {
  const tmpDir = os.tmpdir();
  const uid = crypto.randomUUID();
  const inputPath = path.join(tmpDir, `clean_in_${uid}.mp4`);
  const outputPath = path.join(tmpDir, `clean_out_${uid}.mp4`);

  // Allowlist de origem + teto de bytes (SSRF/DoS): o source_url pode vir de
  // um media_url informado pelo usuário. Sem User-Agent de CDN: o padrão do
  // undici é o que já funcionava aqui (Storage do Supabase).
  const buffer = await fetchMediaBytes(videoUrl, { timeoutMs: DOWNLOAD_TIMEOUT_MS, headers: {} });
  if (buffer.byteLength < 1024) {
    throw new Error(`Arquivo muito pequeno para ser um vídeo válido: ${buffer.byteLength} bytes`);
  }
  fs.writeFileSync(inputPath, buffer);

  const cleanupAll = () => {
    for (const p of [inputPath, outputPath]) {
      try { fs.unlinkSync(p); } catch { /* ok */ }
    }
  };

  try {
    await new Promise<void>((resolve, reject) => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const cmd = ffmpeg(inputPath)
        .outputOptions(CLEAN_METADATA_OUTPUT_OPTIONS)
        .output(outputPath)
        .on("end", () => { clearTimeout(timer); resolve(); })
        .on("error", (err: Error) => { clearTimeout(timer); reject(new Error(`FFmpeg: ${err.message}`)); });
      cmd.run();
      timer = setTimeout(() => {
        try { (cmd as unknown as { kill: (s: string) => void }).kill("SIGKILL"); } catch { /* ok */ }
        reject(new Error(`FFmpeg clean timeout (>${FFMPEG_TIMEOUT_MS / 1000}s)`));
      }, FFMPEG_TIMEOUT_MS);
    });
  } catch (err) {
    cleanupAll();
    throw err;
  }

  const stats = fs.statSync(outputPath);
  return { outputPath, fileSize: stats.size, cleanup: cleanupAll };
}
