/**
 * video-effects.ts — Motor de efeitos de vídeo via FFmpeg
 *
 * Todos os efeitos são aplicados com re-encoding H.264 (preset ultrafast)
 * para garantir compatibilidade total com a Meta Graph API (Reels).
 *
 * Ordem de aplicação:
 *   1. hflip / vflip  — transformações geométricas (mudam estrutura de pixels)
 *   2. negate         — inversão de cor
 *   3. zoom           — scale 115% + crop centrado de volta ao tamanho original
 *   4. smartblur      — desfoque leve de luminância (filtro espacial)
 *   5. noise          — ruído temporal frame-a-frame (aplicado depois do blur)
 *   6. eq             — micro-ajuste de cor por conta (anti-AI determinístico)
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
  mirror: boolean;   // hflip — inversão horizontal
  invert: boolean;   // negate — inversão de cores
  zoom: boolean;     // +15% zoom: scale 115% + crop centrado
  blur: boolean;     // smartblur leve — imperceptível, muda assinatura espacial
  noise: boolean;    // ruído temporal frame-a-frame — muda hash por frame
  antiAi: boolean;   // micro-eq determinístico por conta — cor única por conta
  accountId?: string; // usado por antiAi para gerar cor determinística
}

/**
 * Gera parâmetros de eq determinísticos únicos por account_id.
 * Imperceptíveis ao olho humano, mas alteram todos os pixels de forma consistente.
 */
function accountColorParams(accountId: string): { contrast: number; brightness: number; saturation: number } {
  let h = 0x811c9dc5;
  for (let i = 0; i < accountId.length; i++) {
    h ^= accountId.charCodeAt(i);
    h = (h * 0x01000193) >>> 0;
  }
  // Ranges imperceptíveis: contrast 1.005–1.015, brightness 0.002–0.009, sat 1.005–1.015
  const contrast   = 1.005 + (h % 11) * 0.001;
  const brightness = 0.002 + ((h >> 4) % 8) * 0.001;
  const saturation = 1.005 + ((h >> 8) % 11) * 0.001;
  return { contrast, brightness, saturation };
}

/**
 * Aplica os efeitos configurados no loop a um vídeo do Supabase Storage.
 * Retorna a URL do vídeo processado (armazenado em `temp/` no mesmo bucket).
 * Se nenhum efeito estiver ativo, retorna a URL original sem processamento.
 */
export async function applyVideoEffects(
  videoUrl: string,
  opts: VideoEffectOptions
): Promise<string> {
  const { mirror, invert, zoom, blur, noise, antiAi, accountId = "" } = opts;
  const anyEffect = mirror || invert || zoom || blur || noise || antiAi;
  if (!anyEffect) return videoUrl;

  const tmpDir = os.tmpdir();
  const uid    = crypto.randomUUID();
  const input  = path.join(tmpDir, `vfx_in_${uid}.mp4`);
  const output = path.join(tmpDir, `vfx_out_${uid}.mp4`);

  try {
    // ── 1. Download do vídeo ────────────────────────────────────────────────
    const res = await fetch(videoUrl, { signal: AbortSignal.timeout(45_000) });
    if (!res.ok) throw new Error(`Download falhou: HTTP ${res.status}`);
    fs.writeFileSync(input, Buffer.from(await res.arrayBuffer()));

    // ── 2. Monta cadeia de filtros vf ───────────────────────────────────────
    const vf: string[] = [];

    // Transformações geométricas
    if (mirror) vf.push("hflip");
    if (invert) vf.push("negate");

    // Zoom 15%: escala para 115%, recorta de volta ao tamanho original centralizado.
    // iw/ih no filtro crop referem-se ao OUTPUT do scale (já ampliado).
    // Divisão inteira garante pixels pares exigidos pelo codec H.264.
    if (zoom) {
      vf.push(
        "scale=iw*115/100:ih*115/100," +
        "crop=iw*100/115:ih*100/115:(iw-iw*100/115)/2:(ih-ih*100/115)/2"
      );
    }

    // Desfoque leve: raio 1px de luminância, força 0.25 — muda assinatura espacial
    if (blur) {
      vf.push("smartblur=lr=1:ls=0.25:lt=0");
    }

    // Grão temporal: força 3/100, tipo temporal+uniforme — muda hash frame a frame
    if (noise) {
      vf.push("noise=c0s=3:c0f=t+u");
    }

    // Anti-IA: micro-ajuste de contraste/brilho/saturação único por conta
    if (antiAi) {
      const { contrast, brightness, saturation } = accountColorParams(accountId);
      vf.push(
        `eq=contrast=${contrast.toFixed(4)}:brightness=${brightness.toFixed(4)}:saturation=${saturation.toFixed(4)}`
      );
    }

    // ── 3. Codificação com libx264 ultrafast ────────────────────────────────
    const outputOptions: string[] = [];
    if (vf.length > 0) outputOptions.push("-vf", vf.join(","));

    outputOptions.push(
      "-c:v", "libx264",
      "-preset", "ultrafast",
      "-crf",    "22",
      "-c:a",    "copy",
      "-map_metadata", "-1",
      "-map_chapters", "-1",
      "-movflags", "+faststart",
      "-f", "mp4",
    );

    await new Promise<void>((resolve, reject) => {
      ffmpeg(input)
        .outputOptions(outputOptions)
        .output(output)
        .on("end",   () => resolve())
        .on("error", (err: Error) => reject(new Error(`FFmpeg: ${err.message}`)))
        .run();
    });

    // ── 4. Upload para Supabase Storage (temp/) ─────────────────────────────
    const buf         = fs.readFileSync(output);
    const storagePath = `temp/vfx_${uid}.mp4`;
    const admin       = getSupabaseAdmin();

    const { error: upErr } = await admin.storage
      .from("videos-library")
      .upload(storagePath, buf, { contentType: "video/mp4", upsert: false });

    if (upErr) throw new Error(`Upload temp: ${upErr.message}`);

    const { data: urlData } = admin.storage
      .from("videos-library")
      .getPublicUrl(storagePath);

    const activeFx = Object.entries({ mirror, invert, zoom, blur, noise, antiAi })
      .filter(([, v]) => v).map(([k]) => k).join("+");

    console.log(
      `[video-effects] ✓ efeitos [${activeFx}] | ` +
      `${(buf.length / 1_048_576).toFixed(1)} MB → ${storagePath}`
    );

    return urlData.publicUrl;

  } finally {
    for (const p of [input, output]) {
      try { fs.unlinkSync(p); } catch { /* ok */ }
    }
  }
}
