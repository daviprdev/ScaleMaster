/**
 * video-effects.ts — Efeitos criativos de vídeo via FFmpeg
 *
 * O FFmpeg SÓ é executado quando o usuário ativa pelo menos um efeito no
 * painel do Loop. Sem efeitos ativos, o vídeo original é postado diretamente
 * (zero re-encoding, qualidade máxima, sem degradação generacional).
 *
 * Efeitos disponíveis (toggles no painel):
 *   - hflip:     inversão horizontal
 *   - negate:    inversão de cores
 *   - zoom:      scale 115% + crop centrado
 *   - smartblur: desfoque leve de luminância
 *   - noise:     ruído frame-a-frame
 *   - antiAi:    micro-ajuste de cor único por conta (derrota detecção de IA)
 *
 * Parâmetros de encode quando algum efeito está ativo:
 *   - libx264 preset ultrafast, CRF 22 (alta qualidade)
 *   - -map 0:v:0 / 0:a:0? — extração pura de tracks
 *   - -map_metadata -1 / -map_chapters -1 — limpa metadados
 *   - -movflags +faststart — moov atom na frente
 */

import ffmpeg from "fluent-ffmpeg";
import ffmpegInstaller from "@ffmpeg-installer/ffmpeg";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import * as crypto from "crypto";
import { getSupabaseAdmin } from "@/lib/supabase";

ffmpeg.setFfmpegPath(ffmpegInstaller.path);

export interface VideoEffectOptions {
  mirror:   boolean;
  invert:   boolean;
  zoom:     boolean;
  blur:     boolean;
  noise:    boolean;
  antiAi:   boolean;
  accountId?: string;
}

// ── FNV-1a — hash determinístico por accountId para o efeito antiAi ─────────

function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}

/**
 * Parâmetros do efeito antiAi: ajuste de cor único por conta.
 * Usado APENAS quando o usuário ativa o toggle antiAi no painel.
 * Range ±3% — imperceptível ao espectador mas muda o pHash colorimétrico.
 */
function antiAiColorParams(accountId: string): {
  contrast: number;
  brightness: number;
  saturation: number;
} {
  const h0 = fnv1a(accountId + "_ai");
  const contrast   = 0.975 + (h0 % 51) * 0.001;            // 0.975–1.025
  const brightness = -0.012 + ((h0 >> 8) % 25) * 0.001;    // -0.012–+0.012
  const saturation = 0.975 + ((h0 >> 16) % 51) * 0.001;    // 0.975–1.025
  return { contrast, brightness, saturation };
}

export async function applyVideoEffects(
  videoUrl: string,
  opts: VideoEffectOptions
): Promise<string> {
  const { mirror, invert, zoom, blur, noise, antiAi, accountId = "" } = opts;

  // Sem efeito ativo → retorna original sem nenhum processamento.
  // Zero re-encoding = zero degradação de qualidade = máximo potencial de views.
  const anyEffect = mirror || invert || zoom || blur || noise || antiAi;
  if (!anyEffect) return videoUrl;

  const tmpDir = os.tmpdir();
  const uid    = crypto.randomUUID();
  const input  = path.join(tmpDir, `vfx_in_${uid}.mp4`);
  const output = path.join(tmpDir, `vfx_out_${uid}.mp4`);

  try {
    // ── 1. Download ──────────────────────────────────────────────────────────
    const res = await fetch(videoUrl, { signal: AbortSignal.timeout(45_000) });
    if (!res.ok) throw new Error(`Download falhou: HTTP ${res.status}`);
    const inputBuf = Buffer.from(await res.arrayBuffer());
    fs.writeFileSync(input, inputBuf);
    const inputSizeMB = (inputBuf.length / 1_048_576).toFixed(1);

    // ── 2. Cadeia de filtros de vídeo ────────────────────────────────────────
    const vf: string[] = [];

    if (mirror) vf.push("hflip");
    if (invert) vf.push("negate");
    if (zoom) {
      // Aritmética 20/23 garante dimensão par no FFmpeg 4.1 (yuv420p).
      vf.push(
        "scale=trunc(iw*23/40)*2:trunc(ih*23/40)*2," +
        "crop=trunc(iw*20/46)*2:trunc(ih*20/46)*2:(iw-trunc(iw*20/46)*2)/2:(ih-trunc(ih*20/46)*2)/2"
      );
    }
    if (blur)  vf.push("smartblur=lr=1:ls=0.25:lt=0");
    if (noise) vf.push("noise=c0s=3");

    // antiAi: micro-ajuste de cor único por conta — derrota detecção por pHash.
    // hue REMOVIDO: ERANGE no FFmpeg 4.1 em streams H.264 com SPS/PPS mid-stream.
    if (antiAi && accountId) {
      const { contrast, brightness, saturation } = antiAiColorParams(accountId);
      vf.push(
        `eq=contrast=${contrast.toFixed(4)}:brightness=${brightness.toFixed(4)}:saturation=${saturation.toFixed(4)}`
      );
    }

    // ── 3. Encode ────────────────────────────────────────────────────────────
    const outputOptions: string[] = [
      "-map", "0:v:0",
      "-map", "0:a:0?",
    ];
    if (vf.length > 0) outputOptions.push("-vf", vf.join(","));

    outputOptions.push(
      "-c:v", "libx264",
      "-preset", "ultrafast",
      "-crf", "22",
      "-c:a", "copy",          // áudio em stream copy — sem re-encode desnecessário
      "-map_metadata", "-1",
      "-map_chapters", "-1",
      "-movflags", "+faststart",
      "-f", "mp4",
    );

    await new Promise<void>((resolve, reject) => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const cmd = ffmpeg(input)
        .outputOptions(outputOptions)
        .output(output)
        .on("end", () => { clearTimeout(timer); resolve(); })
        .on("error", (err: Error) => { clearTimeout(timer); reject(new Error(`FFmpeg: ${err.message}`)); });
      cmd.run();
      timer = setTimeout(() => {
        try { (cmd as any).kill("SIGKILL"); } catch { /* já terminou */ }
        reject(new Error(`FFmpeg timeout (>45s)`));
      }, 45_000);
    });

    // ── 4. Upload para Supabase Storage (temp/) ──────────────────────────────
    const buf          = fs.readFileSync(output);
    const outputSizeMB = (buf.length / 1_048_576).toFixed(1);
    const storagePath  = `temp/vfx_${uid}.mp4`;
    const admin        = getSupabaseAdmin();

    const { error: upErr } = await admin.storage
      .from("videos-library")
      .upload(storagePath, buf, { contentType: "video/mp4", upsert: false });

    if (upErr) throw new Error(`Upload temp: ${upErr.message}`);

    const { data: urlData } = admin.storage
      .from("videos-library")
      .getPublicUrl(storagePath);

    const activeFx = [
      mirror  ? "mirror"  : "",
      invert  ? "invert"  : "",
      zoom    ? "zoom"    : "",
      blur    ? "blur"    : "",
      noise   ? "noise"   : "",
      antiAi  ? "antiAi"  : "",
    ].filter(Boolean).join("+");

    console.log(
      `[video-effects] ✓ [${activeFx}] | ${inputSizeMB} MB in → ${outputSizeMB} MB out → ${storagePath}`
    );

    return urlData.publicUrl;

  } finally {
    for (const p of [input, output]) {
      try { fs.unlinkSync(p); } catch { /* ok */ }
    }
  }
}
