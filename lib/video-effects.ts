/**
 * video-effects.ts — Motor de efeitos de vídeo via FFmpeg
 *
 * Dois níveis de processamento:
 *
 * 1. BASE FINGERPRINT (sempre aplicado quando accountId presente)
 *    Objetivo: tornar cada vídeo único por conta para derrotar a detecção
 *    VPDQ da Meta, SEM impacto visível para o espectador nem para o algoritmo.
 *
 *    Parâmetros (todos imperceptíveis ao olho/ouvido):
 *    - Velocidade ±1%:  30s → 29.7–30.3s — muda quais frames o VPDQ amostra;
 *                       abaixo do limiar de percepção (~3%); preserva retenção.
 *    - Eq ±3%: contrast/brightness/saturation únicos por conta — derrota pHash
 *              colorimétrico; invisível ao lado do original.
 *    - Volume ±2%: quebra AudioID da Meta; inaudível ao espectador.
 *    - CRF 20–23 por conta: re-encode em qualidade SUPERIOR ao original
 *      (Instagram fonte ~CRF 32); quando Instagram re-transcodifica para entrega,
 *      parte de uma fonte melhor → vídeo final de qualidade superior → mais views.
 *      DCT artifacts únicos por conta contribuem para fingerprint distinto.
 *
 *    Motivos das remoções:
 *    - Ruído (c0s): consumia ≈80% do CPU → timeouts em serverless.
 *    - Unsharp: overhead sem benefício mensurável para fingerprint.
 *    - Speed ±4% anterior: perceptível → queda de retenção → supressão pelo algoritmo.
 *    - CRF 30–34 anterior: degradava qualidade (dupla compressão lossy) → algoritmo
 *      do Instagram penaliza vídeos de baixa qualidade na distribuição inicial.
 *    - hue, colorchannelmixer, crop+scale: ERANGE/EINVAL no FFmpeg 4.1.
 *
 * 2. EFEITOS CRIATIVOS (ativados pelo usuário no painel de Loop)
 *    Visualmente perceptíveis. Aplicados em cima do base fingerprint.
 *    - hflip:     inversão horizontal
 *    - negate:    inversão de cores
 *    - zoom:      scale 115% + crop centrado
 *    - smartblur: desfoque leve de luminância
 *    - noise:     ruído frame-a-frame
 *    - antiAi:    eq mais agressivo (±4.5%) derivado do accountId
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

// ── FNV-1a hash — rápido, boa distribuição em domínio pequeno (UUIDs) ───────

function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}

/**
 * Parâmetros BASE: variações imperceptíveis ao espectador, únicas por conta.
 *
 * Princípio: qualquer mudança que o algoritmo do Instagram consiga medir
 * negativamente (queda de retenção, qualidade degradada) vai PREJUDICAR as views.
 * Todos os parâmetros aqui estão bem abaixo do limiar de percepção humana.
 *
 * speed:      0.990–1.010 (±1%)    — abaixo do limiar perceptível (~3%);
 *             ±4% anterior era visível e prejudicava tempo de assistência.
 * contrast:   0.970–1.030 (±3%)    — invisível ao lado do original.
 * brightness: -0.015–+0.015 (±1.5%) — imperceptível.
 * saturation: 0.970–1.030 (±3%)    — imperceptível.
 * volume:     0.980–1.020 (±2%)    — inaudível (limiar humano ~5%).
 * crf:        20–23 por conta      — alta qualidade: Instagram re-transcodifica
 *             de fonte melhor → qualidade final superior → mais distribuição.
 */
function baseParams(accountId: string): {
  speed: number;
  contrast: number;
  brightness: number;
  saturation: number;
  volume: number;
  crf: number;
} {
  const h0 = fnv1a(accountId);
  const h1 = fnv1a(accountId + "\x01");
  const h2 = fnv1a(accountId + "\x02");

  const speed      = 0.990 + (h0 % 21) * 0.001;           // 0.990–1.010 (±1%)
  const contrast   = 0.970 + ((h0 >> 8) % 61) * 0.001;    // 0.970–1.030 (±3%)
  const brightness = -0.015 + ((h0 >> 16) % 31) * 0.001;  // -0.015–+0.015
  const saturation = 0.970 + ((h0 >> 24) % 61) * 0.001;   // 0.970–1.030 (±3%)
  const volume     = 0.980 + ((h1 >> 5) % 41) * 0.001;    // 0.980–1.020 (±2%)
  const crf        = 20 + ((h2 >> 3) % 4);                 // 20, 21, 22 ou 23

  return { speed, contrast, brightness, saturation, volume, crf };
}

/**
 * Parâmetros antiAi: variações mais agressivas (±4.5%).
 * Visualmente perceptíveis se comparados lado a lado — usados APENAS quando
 * o usuário ativa o toggle antiAi no painel. Sobrepõe o base fingerprint.
 */
function antiAiParams(accountId: string): {
  contrast: number;
  brightness: number;
  saturation: number;
  volume: number;
} {
  const h0 = fnv1a(accountId + "_ai");
  const h1 = fnv1a(accountId + "_ai\x01");
  const contrast   = 0.955 + (h0 % 91) * 0.001;           // 0.955–1.045 (±4.5%)
  const brightness = -0.022 + ((h0 >> 5) % 45) * 0.001;   // -0.022–+0.022
  const saturation = 0.955 + ((h0 >> 10) % 91) * 0.001;   // 0.955–1.045
  const volume     = 0.960 + ((h1 >> 5) % 81) * 0.001;    // 0.960–1.040
  return { contrast, brightness, saturation, volume };
}

export async function applyVideoEffects(
  videoUrl: string,
  opts: VideoEffectOptions
): Promise<string> {
  const { mirror, invert, zoom, blur, noise, antiAi, accountId = "" } = opts;

  const anyCreativeEffect = mirror || invert || zoom || blur || noise || antiAi;
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
    const inputBuf = Buffer.from(await res.arrayBuffer());
    fs.writeFileSync(input, inputBuf);
    const inputSizeMB = (inputBuf.length / 1_048_576).toFixed(1);

    // ── 2. Parâmetros por conta ──────────────────────────────────────────────
    const base        = runBase ? baseParams(accountId) : null;
    const colorParams = base ? (antiAi ? antiAiParams(accountId) : base) : null;
    const speed       = base?.speed ?? 1.0;
    const volume      = colorParams?.volume ?? 1.0;
    const activeCrf   = base?.crf ?? 22;

    // ── 3. Filtros de vídeo ──────────────────────────────────────────────────
    const vf: string[] = [];

    // ── 3a. Efeitos criativos ────────────────────────────────────────────────
    if (mirror) vf.push("hflip");
    if (invert) vf.push("negate");
    if (zoom) {
      // Scale 115% com aritmética 20/23 para garantir dimensão par no FFmpeg 4.1.
      vf.push(
        "scale=trunc(iw*23/40)*2:trunc(ih*23/40)*2," +
        "crop=trunc(iw*20/46)*2:trunc(ih*20/46)*2:(iw-trunc(iw*20/46)*2)/2:(ih-trunc(ih*20/46)*2)/2"
      );
    }
    if (blur)  vf.push("smartblur=lr=1:ls=0.25:lt=0");
    if (noise) vf.push("noise=c0s=3");

    // ── 3b. Base fingerprint: eq de cor ─────────────────────────────────────
    // Varia contrast/brightness/saturation de forma única por conta.
    // Range ±3%: invisível ao espectador, suficiente para flip de bits no VPDQ.
    // hue REMOVIDO: ERANGE no FFmpeg 4.1 em streams H.264 com SPS/PPS mid-stream.
    if (colorParams) {
      const { contrast, brightness, saturation } = colorParams;
      vf.push(
        `eq=contrast=${contrast.toFixed(4)}:brightness=${brightness.toFixed(4)}:saturation=${saturation.toFixed(4)}`
      );
    }

    // ── 3c. Base fingerprint: micro-velocidade ───────────────────────────────
    // ±1%: imperceptível (limiar humano ~3%), muda quais frames o VPDQ amostra.
    // Anterior era ±4% — perceptível, prejudicava retenção e suprimia views.
    if (base) {
      vf.push(`setpts=${speed.toFixed(4)}*PTS`);
    }

    // ── 4. Filtros de áudio ──────────────────────────────────────────────────
    // volume: quebra AudioID/Chromaprint da Meta (±2%, inaudível).
    // atempo: sincroniza áudio com o shift de velocidade do setpts.
    const af: string[] = [];
    if (base) {
      af.push(`volume=${volume.toFixed(4)}`);
      af.push(`atempo=${speed.toFixed(4)}`);
    }

    // ── 5. Codificação libx264 ultrafast + CRF 20–23 ─────────────────────────
    // CRF 20–23 = qualidade superior ao original (Instagram fonte ~CRF 32).
    // Instagram re-transcodifica para entrega → parte de fonte de alta qualidade
    // → output final melhor para o espectador → algoritmo distribui mais.
    // CRF 30–34 anterior causava dupla compressão lossy → qualidade degradada.
    // -map 0:v:0 / 0:a:0? descarta data streams e SEI atoms do CDN fonte.
    const outputOptions: string[] = [
      "-map", "0:v:0",
      "-map", "0:a:0?",
    ];
    if (vf.length > 0) outputOptions.push("-vf", vf.join(","));
    if (af.length > 0) outputOptions.push("-af", af.join(","));

    outputOptions.push(
      "-c:v", "libx264",
      "-preset", "ultrafast",
      "-crf", String(activeCrf),
      "-c:a", "aac",
      "-b:a", "128k",
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
        reject(new Error(`FFmpeg timeout (>45s) — vídeo muito grande ou CPU sobrecarregado`));
      }, 45_000);
    });

    // ── 6. Upload para Supabase Storage (temp/) ──────────────────────────────
    const buf         = fs.readFileSync(output);
    const outputSizeMB = (buf.length / 1_048_576).toFixed(1);
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
      ...(mirror  ? ["mirror"]  : []),
      ...(invert  ? ["invert"]  : []),
      ...(zoom    ? ["zoom"]    : []),
      ...(blur    ? ["blur"]    : []),
      ...(noise   ? ["noise"]   : []),
      ...(antiAi  ? ["antiAi"]  : []),
      ...(base    ? [
        `spd=${speed.toFixed(3)}`,
        `vol=${volume.toFixed(3)}`,
        `crf=${activeCrf}`,
      ] : []),
    ].join("+");

    console.log(
      `[video-effects] ✓ [${activeFx}] | ` +
      `${inputSizeMB} MB in → ${outputSizeMB} MB out → ${storagePath}`
    );

    return urlData.publicUrl;

  } finally {
    for (const p of [input, output]) {
      try { fs.unlinkSync(p); } catch { /* ok */ }
    }
  }
}
