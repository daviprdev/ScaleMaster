/**
 * video-effects.ts — Motor de efeitos de vídeo via FFmpeg
 *
 * Dois níveis de processamento:
 *
 * 1. BASE FINGERPRINT (sempre aplicado quando accountId presente)
 *    Objetivo: tornar cada vídeo único por conta para derrotar fingerprinting.
 *    - Velocidade ±4%: muda quais frames são amostrados pelo pHash temporal da Meta
 *    - Eq cor: contrast/brightness/saturation únicos por conta (±2.4%)
 *    - Ruído luma 20–45 + chroma 8–18: forte o suficiente para exceder o limiar do PDQ (32 bits)
 *    - Unsharp mask 0.2–0.8: varia nitidez de borda por conta
 *    - CRF 18–26 por conta: quantização diferente = DCT artifacts únicos
 *    - Audio volume ±4.5% + tempo ±4%: quebra Chromaprint/AudioID da Meta
 *    Nota: todos os filtros do base fingerprint operam em yuv420p sem mudar
 *    dimensões nem colorspace — garantia de estabilidade no FFmpeg 4.1.
 *    Filtro `hue` REMOVIDO: apesar de constante, realiza rotação de matriz Cb/Cr
 *    internamente e falha com ERANGE em streams H.264 com SPS/PPS mid-stream
 *    (mesma raiz do colorchannelmixer). Diversidade colorimétrica mantida via
 *    eq saturation ±2.4% + chroma noise c1s/c2s 3–9 nos canais Cb/Cr.
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
 * speed:        0.960–1.040 (±4%, 81 valores) — muda quais frames o PDQ da Meta amostra;
 *               ±1.5% era insuficiente para sair do limiar de 32 bits do fingerprint temporal
 * contrast:     1.008–1.032 (±2.4%)
 * brightness:   0.005–0.025
 * saturation:   1.008–1.032 (±2.4%)
 * lumaNoise:    20–45 (bloco H.264 luma)  — forte o suficiente para alterar >32 bits do PDQ hash
 * chromaNoise:  8–18  (canais Cb/Cr)      — perturba histograma de cor Cb/Cr por conta
 * volume:       0.955–1.045 (±4.5%)
 * crf:          18–26 por conta           — era 18–24 (range maior = maior diversidade de DCT)
 * unsharp:      0.2–0.8
 */
function baseParams(accountId: string): {
  speed: number;
  contrast: number;
  brightness: number;
  saturation: number;
  lumaNoise: number;
  chromaNoise: number;
  volume: number;
  crf: number;
  unsharp: number;
} {
  // Três entradas de hash independentes para evitar correlação entre parâmetros.
  const h0 = fnv1a(accountId);
  const h1 = fnv1a(accountId + "\x01");
  const h2 = fnv1a(accountId + "\x02");

  // speed: 0.960–1.040 (±4%, 81 valores) — muda quais frames o PDQ amostra
  const speed       = 0.960 + (h0 % 81) * 0.001;
  // contrast: 1.008–1.032 (±2.4%, 25 valores)
  const contrast    = 1.008 + ((h0 >> 7) % 25) * 0.001;
  // brightness: 0.005–0.025 (21 valores)
  const brightness  = 0.005 + ((h0 >> 12) % 21) * 0.001;
  // saturation: 1.008–1.032 (±2.4%, 25 valores)
  const saturation  = 1.008 + ((h0 >> 17) % 25) * 0.001;
  // lumaNoise: 20–45 (26 valores) — forte o suficiente para exceder limiar PDQ da Meta
  const lumaNoise   = 20 + (h1 % 26);
  // chromaNoise: 8–18 (11 valores) — perturba histograma Cb/Cr
  const chromaNoise = 8 + ((h1 >> 5) % 11);
  // volume: 0.955–1.045 (±4.5%, 19 passos de 0.005)
  const volume      = 0.955 + ((h1 >> 10) % 19) * 0.005;
  // crf: 18–26 por conta (9 valores) — diversidade maior de DCT artifacts
  const crf         = 18 + ((h2 >> 5) % 9);
  // unsharp: 0.2–0.8 (7 valores) — nitidez de borda única por conta
  const unsharp     = 0.2 + ((h2 >> 10) % 7) * 0.1;

  return { speed, contrast, brightness, saturation, lumaNoise, chromaNoise, volume, crf, unsharp };
}

/**
 * Parâmetros de efeito antiAi: variações ainda maiores que o base.
 * Sobrepõe os parâmetros de cor/hue/volume do base quando antiAi está ativo.
 */
function antiAiParams(accountId: string): {
  contrast: number;
  brightness: number;
  saturation: number;
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
  // volume: 0.945–1.055 (±5.5% — mais forte que base ±4.5%)
  const volume     = 0.945 + ((h1 >> 5) % 23) * 0.005;
  return { contrast, brightness, saturation, volume };
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
    // Parâmetros de cor/volume: antiAi usa variação maior, sobrepõe base.
    const colorParams = base ? (antiAi ? antiAiParams(accountId) : base) : null;
    const speed       = base?.speed ?? 1.0;
    const audioVolume = colorParams?.volume ?? 1.0;
    const activeCrf   = base?.crf ?? 22;
    const activeUnsharp = base?.unsharp ?? 0;

    // ── 3. Cadeia de filtros de vídeo ────────────────────────────────────────
    const vf: string[] = [];

    // ── 3a. Efeitos criativos ────────────────────────────────────────────────
    if (mirror) vf.push("hflip");
    if (invert) vf.push("negate");
    if (zoom) {
      // Scale 115% = 23/20. Reverse crop uses 20/23.
      // IMPORTANTE: usar 20/23 em vez de 100/115 — aritmética inteira do FFmpeg 4.1:
      //   1242*100/115 = 1079 (ímpar!) → libx264 falha em yuv420p.
      //   1242*20/23  = 1080 (par)    → correto.
      // trunc(.../2)*2 garante dimensão par mesmo em vídeos com dimensões não-múltiplas de 20.
      vf.push(
        "scale=trunc(iw*23/40)*2:trunc(ih*23/40)*2," +
        "crop=trunc(iw*20/46)*2:trunc(ih*20/46)*2:(iw-trunc(iw*20/46)*2)/2:(ih-trunc(ih*20/46)*2)/2"
      );
    }
    if (blur) vf.push("smartblur=lr=1:ls=0.25:lt=0");
    if (noise) vf.push("noise=c0s=3");

    // ── 3b. Base fingerprint: micro-cor ─────────────────────────────────────
    // eq: contrast/brightness/saturation únicos por conta — derrota pHash colorimétrico.
    // hue REMOVIDO: filtro `hue` causa ERANGE em FFmpeg 4.1 em streams H.264 com
    // mudança de SPS/PPS mid-stream (mesma raiz do colorchannelmixer removido anteriormente).
    // Diversidade colorimétrica mantida via eq saturation ±2.4% + chroma noise c1s/c2s.
    if (colorParams) {
      const { contrast, brightness, saturation } = colorParams;
      vf.push(
        `eq=contrast=${contrast.toFixed(4)}:brightness=${brightness.toFixed(4)}:saturation=${saturation.toFixed(4)}`
      );
    }

    // ── 3c. Base fingerprint: micro-velocidade de vídeo ──────────────────────
    // setpts altera todos os PTS (presentation timestamps) → fingerprint temporal
    // único por conta. ±4% muda quais frames são amostrados pelo PDQ da Meta.
    if (base) {
      vf.push(`setpts=${speed.toFixed(4)}*PTS`);
    }

    // ── 3d. Base fingerprint: ruído luma + chroma ────────────────────────────
    // c0s: luma (Y) 20–45 — forte o suficiente para exceder o limiar de 32 bits do PDQ
    // c1s/c2s: chroma (Cb/Cr) 8–18 — perturba histograma de cor por conta
    if (base && !noise) {
      vf.push(
        `noise=c0s=${base.lumaNoise}:c1s=${base.chromaNoise}:c2s=${base.chromaNoise}`
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
    // Variações de ±4.5% em volume e ±4% em tempo — imperceptíveis ao ouvido.
    const audioFilters = base
      ? [`volume=${audioVolume.toFixed(3)}`, `atempo=${speed.toFixed(4)}`]
      : [];

    // ── 5. Codificação com libx264 ultrafast + CRF dinâmico ──────────────────
    // -crf activeCrf (18–26 por conta): quantização diferente por conta garante
    // DCT artifacts e padrões de macroblock distintos mesmo para o mesmo conteúdo.
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

    // Timeout de 20s por conta — previne que vídeos grandes travem a função serverless
    // (300s Vercel). Se estourar, o caller captura o erro e posta o vídeo original.
    const FFMPEG_TIMEOUT_MS = 20_000;
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
        reject(new Error(`FFmpeg timeout (>${FFMPEG_TIMEOUT_MS / 1000}s) — vídeo muito grande`));
      }, FFMPEG_TIMEOUT_MS);
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
