/**
 * video-effects.ts — Motor de efeitos de vídeo via FFmpeg
 *
 * Dois níveis de processamento:
 *
 * 1. BASE FINGERPRINT (sempre aplicado quando accountId presente)
 *    Imperceptível ao olho humano. Objetivo: tornar cada vídeo único por conta
 *    para derrotar o fingerprinting visual/temporal do Instagram.
 *    - Micro-velocidade ±0.2%: muda todos os timestamps → quebra fingerprint temporal
 *    - Micro-cor (eq): muda todos os pixels → quebra perceptual hash (pHash)
 *    - Micro-ruído de luminância: muda assinatura de bordas de bloco H.264
 *    - Audio tempo matching: mantém sync A/V após o speed shift
 *
 * 2. EFEITOS CRIATIVOS (ativados pelo usuário no painel de Loop)
 *    Visualmente perceptíveis. Aplicados em cima do base fingerprint.
 *    - hflip: inversão horizontal
 *    - negate: inversão de cores
 *    - zoom: scale 115% + crop centrado
 *    - smartblur: desfoque leve de luminância
 *    - noise: ruído temporal frame-a-frame
 *    - antiAi: eq mais forte derivado do accountId (sobrepõe o base eq)
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
  mirror: boolean;
  invert: boolean;
  zoom: boolean;
  blur: boolean;
  noise: boolean;
  antiAi: boolean;
  accountId?: string;
}

// ── Parâmetros determinísticos por accountId ────────────────────────────────
// FNV-1a hash: rápido, boa distribuição em domínio pequeno (accountId UUID).

function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}

/**
 * Parâmetros de BASE fingerprint: micro-variações imperceptíveis únicas por conta.
 *
 * speed:  0.998–1.002 (±0.2%) — muda todos os timestamps de frame e áudio
 * contrast: 1.004–1.012       — menos de 1.2% — imperceptível
 * brightness: 0.002–0.009     — menos de 1%   — imperceptível
 * saturation: 1.004–1.012     — menos de 1.2% — imperceptível
 * luma_noise: 1–3 (força do ruído de borda de bloco H.264)
 */
function baseParams(accountId: string): {
  speed: number;
  contrast: number;
  brightness: number;
  saturation: number;
  lumaNoise: number;
} {
  const h = fnv1a(accountId);
  // speed: 0.998, 0.999, 1.000, 1.001, 1.002 (5 valores)
  const speed      = 0.998 + (h % 5) * 0.001;
  const contrast   = 1.004 + ((h >> 4) % 9) * 0.001;
  const brightness = 0.002 + ((h >> 8) % 8) * 0.001;
  const saturation = 1.004 + ((h >> 12) % 9) * 0.001;
  const lumaNoise  = 1 + ((h >> 16) % 3);
  return { speed, contrast, brightness, saturation, lumaNoise };
}

/**
 * Parâmetros de efeito antiAi: variação maior que o base, ainda imperceptível.
 * Sobrepõe os parâmetros de base quando antiAi está ativo.
 */
function antiAiParams(accountId: string): { contrast: number; brightness: number; saturation: number } {
  const h = fnv1a(accountId + "_ai");
  const contrast   = 1.005 + (h % 11) * 0.001;
  const brightness = 0.002 + ((h >> 4) % 8) * 0.001;
  const saturation = 1.005 + ((h >> 8) % 11) * 0.001;
  return { contrast, brightness, saturation };
}

export async function applyVideoEffects(
  videoUrl: string,
  opts: VideoEffectOptions
): Promise<string> {
  const { mirror, invert, zoom, blur, noise, antiAi, accountId = "" } = opts;

  const anyCreativeEffect = mirror || invert || zoom || blur || noise || antiAi;
  // Base fingerprint roda sempre que accountId está presente.
  // Sem accountId E sem efeitos criativos: retorna original (nunca acontece em produção,
  // pois process-loops sempre passa accountId).
  const runBase = accountId.length > 0;
  if (!anyCreativeEffect && !runBase) return videoUrl;

  const tmpDir = os.tmpdir();
  const uid    = crypto.randomUUID();
  const input  = path.join(tmpDir, `vfx_in_${uid}.mp4`);
  const output = path.join(tmpDir, `vfx_out_${uid}.mp4`);

  try {
    // ── 1. Download ──────────────────────────────────────────────────────────
    const res = await fetch(videoUrl, { signal: AbortSignal.timeout(45_000) });
    if (!res.ok) throw new Error(`Download falhou: HTTP ${res.status}`);
    fs.writeFileSync(input, Buffer.from(await res.arrayBuffer()));

    // ── 2. Calcula parâmetros ────────────────────────────────────────────────
    const base = runBase ? baseParams(accountId) : null;

    // ── 3. Cadeia de filtros de vídeo ────────────────────────────────────────
    const vf: string[] = [];

    // ── 3a. Efeitos criativos ────────────────────────────────────────────────
    if (mirror) vf.push("hflip");
    if (invert) vf.push("negate");
    if (zoom) {
      vf.push(
        "scale=iw*115/100:ih*115/100," +
        "crop=iw*100/115:ih*100/115:(iw-iw*100/115)/2:(ih-ih*100/115)/2"
      );
    }
    if (blur) vf.push("smartblur=lr=1:ls=0.25:lt=0");
    if (noise) vf.push("noise=c0s=3:c0f=t+u");

    // ── 3b. Base fingerprint: micro-cor ──────────────────────────────────────
    // antiAi usa variação maior (sobrepõe base); se não ativo, usa base.
    if (base) {
      const { contrast, brightness, saturation } = antiAi
        ? antiAiParams(accountId)
        : base;
      vf.push(
        `eq=contrast=${contrast.toFixed(4)}:brightness=${brightness.toFixed(4)}:saturation=${saturation.toFixed(4)}`
      );
    }

    // ── 3c. Base fingerprint: micro-velocidade de vídeo ──────────────────────
    // setpts altera todos os PTS (presentation timestamps) → fingerprint temporal
    // único por conta. ±0.2% é completamente imperceptível ao olho humano.
    const speed = base?.speed ?? 1.0;
    if (base) {
      vf.push(`setpts=${speed.toFixed(4)}*PTS`);
    }

    // ── 3d. Base fingerprint: micro-ruído de luminância ──────────────────────
    // Força 1-3/100 apenas em luma (c0s) — muda assinatura de bordas de bloco
    // H.264 sem afetar a nitidez visual perceptível.
    if (base && !noise) {
      vf.push(`noise=c0s=${base.lumaNoise}:c0f=t+u:c1s=0:c2s=0`);
    }

    // ── 4. Filtro de áudio: tempo matching ──────────────────────────────────
    // atempo mantém sync A/V após o speed shift do setpts.
    // Variação de ±0.2% no pitch do áudio é imperceptível para humanos.
    const audioFilters = base ? [`atempo=${speed.toFixed(4)}`] : [];

    // ── 5. Codificação com libx264 ultrafast ─────────────────────────────────
    const outputOptions: string[] = [];
    if (vf.length > 0) outputOptions.push("-vf", vf.join(","));
    if (audioFilters.length > 0) outputOptions.push("-af", audioFilters.join(","));

    outputOptions.push(
      "-c:v", "libx264",
      "-preset", "ultrafast",
      "-crf",    "22",
      "-c:a",    "aac",     // re-encode audio também (stream copy incompatível com atempo)
      "-b:a",    "128k",
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

    // ── 6. Upload para Supabase Storage (temp/) ──────────────────────────────
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

    const activeFx = [
      ...(mirror   ? ["mirror"]   : []),
      ...(invert   ? ["invert"]   : []),
      ...(zoom     ? ["zoom"]     : []),
      ...(blur     ? ["blur"]     : []),
      ...(noise    ? ["noise"]    : []),
      ...(antiAi   ? ["antiAi"]   : []),
      ...(base     ? [`spd=${speed.toFixed(3)}`, `luma=${base.lumaNoise}`] : []),
    ].join("+");

    console.log(
      `[video-effects] ✓ [${activeFx}] | ` +
      `${(buf.length / 1_048_576).toFixed(1)} MB → ${storagePath}`
    );

    return urlData.publicUrl;

  } finally {
    for (const p of [input, output]) {
      try { fs.unlinkSync(p); } catch { /* ok */ }
    }
  }
}
