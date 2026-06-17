/**
 * video-effects.ts — Motor de efeitos de vídeo via FFmpeg
 *
 * Dois níveis de processamento:
 *
 * 1. BASE FINGERPRINT (sempre aplicado quando accountId presente)
 *    Objetivo: tornar cada vídeo único por conta para derrotar fingerprinting.
 *    - Velocidade ±1.5%: muda frames amostrados pelo pHash temporal (era ±0.5%)
 *    - Eq cor: contrast/brightness/saturation únicos por conta (±2.4%, eram ±1.6%)
 *    - Hue ±8°: rotação de matiz Cb/Cr derrota pHash colorimétrico (era ±3°)
 *    - Ruído luma 6–18 + chroma 2–6: muda assinaturas de bloco DCT (era só luma 2–5)
 *    - Unsharp mask 0.2–0.8: varia nitidez de borda por conta (novo)
 *    - CRF 18–24 por conta: quantização diferente = DCT artifacts únicos (era 22 fixo)
 *    - Audio volume ±4.5% + tempo ±1.5%: quebra Chromaprint/AudioID da Meta
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
 * Parâmetros de BASE fingerprint: variações únicas por conta para derrotar o pHash.
 *
 * Cada parâmetro usa uma entrada de hash independente (accountId + salt distinto)
 * para evitar correlação entre dimensões.
 *
 * speed:        0.985–1.015 (±1.5%, 31 valores) — ±0.5% era insuficiente para mudar
 *               quais frames são amostrados pelo pHash temporal da Meta
 * contrast:     1.008–1.032 (±2.4%)             — era ±1.6% (insuficiente para o 32×32)
 * brightness:   0.005–0.025                      — era 0.003–0.014
 * saturation:   1.008–1.032 (±2.4%)             — era ±1.6%
 * lumaNoise:    6–18  (bloco H.264 luma)         — era 2–5 (muito fraco)
 * chromaNoise:  2–6   (canais Cb/Cr)             — era ZERO (c1s=0:c2s=0 fixo)
 * volume:       0.955–1.045 (±4.5%)             — era ±3%
 * hue:          −8 a +8 graus                   — era ±3° (insuficiente)
 * crf:          18–24 por conta                  — era 22 fixo para todos
 * unsharp:      0.2–0.8                          — novo: varia nitidez de borda por conta
 */
function baseParams(accountId: string): {
  speed: number;
  contrast: number;
  brightness: number;
  saturation: number;
  lumaNoise: number;
  chromaNoise: number;
  volume: number;
  hue: number;
  crf: number;
  unsharp: number;
} {
  // Três entradas de hash independentes para evitar correlação entre parâmetros.
  const h0 = fnv1a(accountId);
  const h1 = fnv1a(accountId + "\x01");
  const h2 = fnv1a(accountId + "\x02");

  // speed: 0.985–1.015 (±1.5%, 31 valores)
  // — 3× mais entropia temporal: frames amostrados pelo pHash em momentos distintos
  const speed       = 0.985 + (h0 % 31) * 0.001;
  // contrast: 1.008–1.032 (±2.4%, 25 valores)
  const contrast    = 1.008 + ((h0 >> 5) % 25) * 0.001;
  // brightness: 0.005–0.025 (21 valores)
  const brightness  = 0.005 + ((h0 >> 10) % 21) * 0.001;
  // saturation: 1.008–1.032 (±2.4%, 25 valores)
  const saturation  = 1.008 + ((h0 >> 15) % 25) * 0.001;
  // lumaNoise: 6–18 (13 valores) — 3× mais forte: muda assinatura de bloco DCT
  const lumaNoise   = 6 + (h1 % 13);
  // chromaNoise: 2–6 (5 valores) — novo: ruído nos canais de cor Cb/Cr
  const chromaNoise = 2 + ((h1 >> 4) % 5);
  // volume: 0.955–1.045 (±4.5%, 19 passos de 0.005) — quebra Chromaprint/AudioID
  const volume      = 0.955 + ((h1 >> 8) % 19) * 0.005;
  // hue: −8 a +8 graus (17 valores) — rotação de matiz derrota pHash colorimétrico
  const hue         = -8 + (h2 % 17);
  // crf: 18–24 por conta (7 valores) — quantização diferente = DCT artifacts únicos
  const crf         = 18 + ((h2 >> 5) % 7);
  // unsharp: 0.2–0.8 (7 valores) — nitidez de borda única por conta
  const unsharp     = 0.2 + ((h2 >> 10) % 7) * 0.1;

  return { speed, contrast, brightness, saturation, lumaNoise, chromaNoise, volume, hue, crf, unsharp };
}

/**
 * Parâmetros de efeito antiAi: variações ainda maiores que o base.
 * Sobrepõe os parâmetros de cor/hue/volume do base quando antiAi está ativo.
 */
function antiAiParams(accountId: string): {
  contrast: number;
  brightness: number;
  saturation: number;
  hue: number;
  volume: number;
} {
  const h0 = fnv1a(accountId + "_ai");
  const h1 = fnv1a(accountId + "_ai\x01");
  // contrast: 1.012–1.040 (±2.8% — mais forte que base ±2.4%)
  const contrast   = 1.012 + (h0 % 29) * 0.001;
  // brightness: 0.008–0.030
  const brightness = 0.008 + ((h0 >> 5) % 23) * 0.001;
  // saturation: 1.012–1.040
  const saturation = 1.012 + ((h0 >> 10) % 29) * 0.001;
  // hue: ±12 graus (mais forte que base ±8)
  const hue        = -12 + ((h1) % 25);
  // volume: 0.945–1.055 (±5.5% — mais forte que base ±4.5%)
  const volume     = 0.945 + ((h1 >> 5) % 23) * 0.005;
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
    const activeCrf   = base?.crf ?? 22;
    const activeUnsharp = base?.unsharp ?? 0;

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
      // hue: ±8° (base) ou ±12° (antiAi) — 2-3× mais forte que antes
      vf.push(`hue=h=${activeHue}`);
    }

    // ── 3c. Base fingerprint: micro-velocidade de vídeo ──────────────────────
    // setpts altera todos os PTS (presentation timestamps) → fingerprint temporal
    // único por conta. ±1.5% muda quais frames são amostrados pelo pHash da Meta.
    if (base) {
      vf.push(`setpts=${speed.toFixed(4)}*PTS`);
    }

    // ── 3d. Base fingerprint: ruído luma + chroma ────────────────────────────
    // c0s: luma (Y) 6–18 — muda assinatura de bloco DCT; era 2–5 (muito fraco)
    // c1s/c2s: chroma (Cb/Cr) 2–6 — novo: acrescenta ruído nos canais de cor,
    // o que derrota fingerprints baseados em histograma de cor e pHash colorimétrico.
    // Quando o efeito criativo "noise" está ativo usa c0s=3 genérico — ignoramos
    // o base noise para não sobrepor.
    if (base && !noise) {
      vf.push(
        `noise=c0s=${base.lumaNoise}:c0f=t+u:c1s=${base.chromaNoise}:c2s=${base.chromaNoise}:c1f=t+u:c2f=t+u`
      );
    }

    // ── 3e. Base fingerprint: unsharp mask (nitidez de borda) ────────────────
    // Varia o realce de borda por conta (0.2–0.8): muda a aparência de contornos
    // mesmo que o conteúdo seja idêntico — derrota fingerprints baseados em
    // detecção de bordas (Canny/LoG). luma_msize=3, chroma=0 (afeta só Y).
    if (base && activeUnsharp > 0) {
      vf.push(`unsharp=3:3:${activeUnsharp.toFixed(1)}:3:3:0.0`);
    }

    // ── 4. Filtros de áudio: volume + tempo matching ─────────────────────────
    // volume=N varia amplitude do áudio por conta → quebra Chromaprint/AudioID
    // atempo mantém sync A/V após o speed shift do setpts.
    // Variações de ±4.5% em volume e ±1.5% em tempo — imperceptíveis ao ouvido.
    const audioFilters = base
      ? [`volume=${audioVolume.toFixed(3)}`, `atempo=${speed.toFixed(4)}`]
      : [];

    // ── 5. Codificação com libx264 ultrafast + CRF dinâmico ──────────────────
    // -crf activeCrf (18–24 por conta): quantização diferente por conta garante
    // DCT artifacts e padrões de macroblock distintos mesmo para o mesmo conteúdo.
    // Era CRF 22 fixo para todos — DCT quase idêntico entre contas.
    // -map 0:v:0 / 0:a:0? — seleção explícita: descarta data streams, SEI atoms.
    const outputOptions: string[] = [
      "-map", "0:v:0",
      "-map", "0:a:0?",
    ];
    if (vf.length > 0) outputOptions.push("-vf", vf.join(","));
    if (audioFilters.length > 0) outputOptions.push("-af", audioFilters.join(","));

    outputOptions.push(
      "-c:v", "libx264",
      "-preset", "ultrafast",
      "-crf",    String(activeCrf),
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
        `chroma=${base.chromaNoise}`,
        `vol=${audioVolume.toFixed(3)}`,
        `hue=${activeHue}°`,
        `crf=${activeCrf}`,
        `sharp=${activeUnsharp.toFixed(1)}`,
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
