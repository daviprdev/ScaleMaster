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
import ffmpegStatic from "ffmpeg-static";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import * as crypto from "crypto";
import { getSupabaseAdmin } from "@/lib/supabase";

ffmpeg.setFfmpegPath(ffmpegStatic as string);

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
 * speed:      0.995–1.005 (±0.5%, 11 valores) — muda todos os timestamps de frame e áudio
 * contrast:   1.004–1.016 (±1.6%)             — imperceptível ao olho humano
 * brightness: 0.003–0.014 (±1.4%)             — imperceptível
 * saturation: 1.004–1.016 (±1.6%)             — imperceptível
 * lumaNoise:  2–5         (bloco H.264 luma)  — assinaturas de bloco mais variadas
 * volume:     0.970–1.030 (±3%)               — quebra Chromaprint/AudioID da Meta
 * hue:        -3 a +3 graus                   — rotação de matiz quebra pHash residual
 */
function baseParams(accountId: string): {
  speed: number;
  contrast: number;
  brightness: number;
  saturation: number;
  lumaNoise: number;
  volume: number;
  hue: number;
} {
  const h = fnv1a(accountId);
  // speed: 0.995–1.005 (±0.5%, 11 valores — mais entropia temporal)
  const speed      = 0.995 + (h % 11) * 0.001;
  // contrast/brightness/saturation: ranges expandidos
  const contrast   = 1.004 + ((h >> 4)  % 13) * 0.001;
  const brightness = 0.003 + ((h >> 8)  % 12) * 0.001;
  const saturation = 1.004 + ((h >> 12) % 13) * 0.001;
  // lumaNoise: 2–5 (era 1–3 — assinatura de borda de bloco mais distinta)
  const lumaNoise  = 2 + ((h >> 16) % 4);
  // volume: 0.970–1.030 em 13 passos de 0.005 — quebra fingerprint de áudio
  const volume     = 0.970 + ((h >> 20) % 13) * 0.005;
  // hue: -3 a +3 graus em 7 passos — rotação de matiz quebra pHash residual
  const hue        = -3 + ((h >> 24) % 7);
  return { speed, contrast, brightness, saturation, lumaNoise, volume, hue };
}

/**
 * Parâmetros de efeito antiAi: variação maior que o base, ainda imperceptível.
 * Sobrepõe os parâmetros de base quando antiAi está ativo.
 * Inclui hue e volume mais fortes para cobertura adicional de fingerprint.
 */
function antiAiParams(accountId: string): {
  contrast: number;
  brightness: number;
  saturation: number;
  hue: number;
  volume: number;
} {
  const h = fnv1a(accountId + "_ai");
  const contrast   = 1.006 + (h % 13) * 0.001;
  const brightness = 0.004 + ((h >> 4) % 12) * 0.001;
  const saturation = 1.006 + ((h >> 8) % 13) * 0.001;
  // antiAi: hue ±5 graus (mais forte que base ±3)
  const hue        = -5 + ((h >> 12) % 11);
  // antiAi: volume 0.960–1.040 (mais forte que base 0.970–1.030)
  const volume     = 0.960 + ((h >> 16) % 17) * 0.005;
  return { contrast, brightness, saturation, hue, volume };
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

    // ── 2. Calcula parâmetros (uma vez, sem chamadas duplicadas) ────────────────
    const base = runBase ? baseParams(accountId) : null;
    // Parâmetros de cor/hue/volume: antiAi usa variação maior, sobrepõe base.
    const colorParams = base ? (antiAi ? antiAiParams(accountId) : base) : null;
    const speed       = base?.speed ?? 1.0;
    const audioVolume = colorParams?.volume ?? 1.0;
    const activeHue   = colorParams?.hue ?? 0;

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

    // ── 3b. Base fingerprint: micro-cor + matiz ──────────────────────────────
    // hue=h=N rotação de matiz em graus: muda coordenadas Cb/Cr de todos os pixels
    // → quebra pHash residual que sobrevive a variações sutis de eq.
    if (colorParams) {
      const { contrast, brightness, saturation } = colorParams;
      vf.push(
        `eq=contrast=${contrast.toFixed(4)}:brightness=${brightness.toFixed(4)}:saturation=${saturation.toFixed(4)}`
      );
      // hue: rotação de matiz ±3° (base) ou ±5° (antiAi) — imperceptível, derrota pHash
      vf.push(`hue=h=${activeHue}`);
    }

    // ── 3c. Base fingerprint: micro-velocidade de vídeo ──────────────────────
    // setpts altera todos os PTS (presentation timestamps) → fingerprint temporal
    // único por conta. ±0.5% é completamente imperceptível ao olho humano.
    if (base) {
      vf.push(`setpts=${speed.toFixed(4)}*PTS`);
    }

    // ── 3d. Base fingerprint: micro-ruído de luminância ──────────────────────
    // Força 2-5/100 apenas em luma (c0s) — muda assinatura de bordas de bloco
    // H.264 sem afetar a nitidez visual perceptível.
    if (base && !noise) {
      vf.push(`noise=c0s=${base.lumaNoise}:c0f=t+u:c1s=0:c2s=0`);
    }

    // ── 4. Filtros de áudio: volume + tempo matching ─────────────────────────
    // volume=N varia amplitude do áudio por conta → quebra Chromaprint/AudioID
    // atempo mantém sync A/V após o speed shift do setpts.
    // Variações de ±3% em volume e ±0.5% em tempo são imperceptíveis para humanos.
    const audioFilters = base
      ? [`volume=${audioVolume.toFixed(3)}`, `atempo=${speed.toFixed(4)}`]
      : [];

    // ── 5. Codificação com libx264 ultrafast ─────────────────────────────────
    // -map 0:v:0 / 0:a:0? — seleção explícita de streams: descarta data streams,
    // SEI custom atoms e tracks de telemetria do CDN que passariam pelo re-encode.
    const outputOptions: string[] = [
      "-map", "0:v:0",
      "-map", "0:a:0?",
    ];
    if (vf.length > 0) outputOptions.push("-vf", vf.join(","));
    if (audioFilters.length > 0) outputOptions.push("-af", audioFilters.join(","));

    outputOptions.push(
      "-c:v", "libx264",
      "-preset", "ultrafast",
      "-crf",    "22",
      "-c:a",    "aac",     // re-encode audio (stream copy incompatível com atempo/volume)
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
      ...(base     ? [
        `spd=${speed.toFixed(3)}`,
        `luma=${base.lumaNoise}`,
        `vol=${audioVolume.toFixed(3)}`,
        `hue=${activeHue}°`,
      ] : []),
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
