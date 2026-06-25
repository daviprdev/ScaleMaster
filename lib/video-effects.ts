/**
 * video-effects.ts — Pipeline de processamento de vídeo anti-fingerprint
 *
 * Todo vídeo postado passa por processVideoForAccount() antes de ir para a Meta.
 * O FFmpeg roda na fila process-videos (não no cron de postagem) para não bloquear.
 *
 * O que o pipeline faz por conta (parâmetros determinísticos via FNV-1a do account_id):
 *   - eq contrast/brightness/saturation ±2%   → quebra pHash colorimétrico
 *   - noise luma c0s=2–4                      → quebra pHash espacial
 *   - asetrate pitch ±1%                      → quebra Chromaprint/AudID
 *   - libx264 CRF 19 ultrafast                → novo bitstream limpo
 *   - -map_metadata -1 + creation_time fake   → remove rastreio + parece captura original
 *   - efeitos criativos do usuário (opcionais): hflip, negate, zoom, blur, noise+, antiAi
 */

import ffmpeg from "fluent-ffmpeg";
import ffmpegInstaller from "@ffmpeg-installer/ffmpeg";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import * as crypto from "crypto";
import { fetch as undiciFetch } from "undici";
import { getSupabaseAdmin } from "@/lib/supabase";

ffmpeg.setFfmpegPath(ffmpegInstaller.path);

export interface VideoEffectOptions {
  mirror:     boolean;
  invert:     boolean;
  zoom:       boolean;
  blur:       boolean;
  noise:      boolean;
  antiAi:     boolean;
  accountId?: string;
}

// ── FNV-1a — hash determinístico por accountId ───────────────────────────────

function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}

// ── Parâmetros base únicos por conta ─────────────────────────────────────────

interface BaseFingerprint {
  contrast:    number;
  brightness:  number;
  saturation:  number;
  noiseLevel:  number;
  pitchFactor: number;
}

function getBaseFingerprint(accountId: string): BaseFingerprint {
  const h0 = fnv1a(accountId + "_eq");
  const h1 = fnv1a(accountId + "_noise");
  const h2 = fnv1a(accountId + "_pitch");
  return {
    contrast:    0.978 + (h0 % 45) * 0.001,          // 0.978–1.022  (±2.2%)
    brightness:  -0.011 + ((h0 >> 8) % 23) * 0.001,  // -0.011–+0.011
    saturation:  0.978 + ((h0 >> 16) % 45) * 0.001,  // 0.978–1.022
    noiseLevel:  2 + (h1 % 3),                        // 2, 3 ou 4
    pitchFactor: 0.990 + (h2 % 21) * 0.001,          // 0.990–1.010  (±1%)
  };
}

// Parâmetros do efeito antiAi: camada adicional de cor única por conta.
function antiAiColorParams(accountId: string): { contrast: number; brightness: number; saturation: number } {
  const h0 = fnv1a(accountId + "_ai");
  return {
    contrast:   0.975 + (h0 % 51) * 0.001,           // 0.975–1.025
    brightness: -0.012 + ((h0 >> 8) % 25) * 0.001,   // -0.012–+0.012
    saturation: 0.975 + ((h0 >> 16) % 51) * 0.001,   // 0.975–1.025
  };
}

// ── Data de criação fake (parece captura original) ────────────────────────────
// Ausência de creation_time é sinal de "arquivo baixado". Injeta data realista.

function randomCreationTime(): string {
  const ninetyDaysMs = 90 * 24 * 60 * 60 * 1000;
  const ts = Date.now() - Math.floor(Math.random() * ninetyDaysMs);
  return new Date(ts).toISOString();
}

// ── Upload para Supabase Storage (temp/) ─────────────────────────────────────

async function uploadToTemp(filePath: string, uid: string): Promise<string> {
  const buf = fs.readFileSync(filePath);
  const storagePath = `temp/vpf_${uid}.mp4`;
  const admin = getSupabaseAdmin();

  const { error } = await admin.storage
    .from("videos-library")
    .upload(storagePath, buf, { contentType: "video/mp4", upsert: false });

  if (error) throw new Error(`Upload temp: ${error.message}`);

  const { data } = admin.storage.from("videos-library").getPublicUrl(storagePath);
  return data.publicUrl;
}

// ── Pipeline principal ────────────────────────────────────────────────────────

/**
 * Processa um vídeo com fingerprint único por conta.
 * Sempre re-encoda — nunca retorna URL original.
 *
 * Base (sempre ativo, parâmetros via FNV-1a do accountId):
 *   eq + noise luma + pitch shift de áudio + CRF 19 + fake creation_time
 *
 * Efeitos criativos (opcionais, ativados no painel do Loop):
 *   mirror, invert, zoom, blur, noise+, antiAi
 */
export async function processVideoForAccount(
  videoUrl: string,
  accountId: string,
  userEffects: {
    mirror?: boolean;
    invert?: boolean;
    zoom?:   boolean;
    blur?:   boolean;
    noise?:  boolean;
    antiAi?: boolean;
  } = {}
): Promise<string> {
  const tmpDir = os.tmpdir();
  const uid    = crypto.randomUUID();
  const input  = path.join(tmpDir, `vpf_in_${uid}.mp4`);
  const output = path.join(tmpDir, `vpf_out_${uid}.mp4`);

  try {
    // ── 1. Download ──────────────────────────────────────────────────────────
    // undici bypasses Next.js 15's patched global fetch (strips dispatcher,
    // may corrupt binary responses from Supabase Storage CDN redirects).
    const res = await undiciFetch(videoUrl, { signal: AbortSignal.timeout(60_000) });
    if (!res.ok) throw new Error(`Download falhou: HTTP ${res.status}`);
    const inputBuf = Buffer.from(await res.arrayBuffer());
    fs.writeFileSync(input, inputBuf);
    const inputSizeMB = (inputBuf.length / 1_048_576).toFixed(1);

    // ── 2. Parâmetros base únicos por conta ──────────────────────────────────
    const seed = accountId || uid; // fallback para downloads sem accountId
    const { contrast, brightness, saturation, noiseLevel, pitchFactor } =
      getBaseFingerprint(seed);

    // ── 3. Cadeia de filtros de vídeo ────────────────────────────────────────
    const vf: string[] = [];

    // Efeitos criativos que vêm ANTES da correção de cor
    if (userEffects.mirror) vf.push("hflip");
    if (userEffects.invert) vf.push("negate");
    if (userEffects.zoom) {
      // Aritmética 20/23 garante dimensão par no FFmpeg 4.1 (yuv420p).
      vf.push(
        "scale=trunc(iw*23/40)*2:trunc(ih*23/40)*2," +
        "crop=trunc(iw*20/46)*2:trunc(ih*20/46)*2:(iw-trunc(iw*20/46)*2)/2:(ih-trunc(ih*20/46)*2)/2"
      );
    }
    if (userEffects.blur) vf.push("smartblur=lr=1:ls=0.25:lt=0");

    // Base anti-fingerprint: cor única por conta (quebra pHash colorimétrico)
    vf.push(
      `eq=contrast=${contrast.toFixed(4)}:brightness=${brightness.toFixed(4)}:saturation=${saturation.toFixed(4)}`
    );

    // Efeito antiAi: segunda camada de cor única (mais agressiva)
    if (userEffects.antiAi && accountId) {
      const ai = antiAiColorParams(accountId);
      vf.push(
        `eq=contrast=${ai.contrast.toFixed(4)}:brightness=${ai.brightness.toFixed(4)}:saturation=${ai.saturation.toFixed(4)}`
      );
    }

    // Base anti-fingerprint: noise luma único por conta (quebra pHash espacial)
    // c0f=u: seed fixo por frame — estável no FFmpeg 4.1 (flags temporais causam ERANGE)
    const noiseLuma = userEffects.noise ? noiseLevel + 2 : noiseLevel; // noise ativo = mais intenso
    vf.push(`noise=c0s=${noiseLuma}:c0f=u`);

    // ── 4. Filtro de áudio: pitch único por conta (quebra Chromaprint/AudID) ─
    const newSampleRate = Math.round(44100 * pitchFactor);

    // ── 5. Fake creation_time (parece captura original, não download) ─────────
    const creationTime = randomCreationTime();

    // ── 6. Encode ────────────────────────────────────────────────────────────
    const outputOptions: string[] = [
      "-map",      "0:v:0",           // extrai apenas a trilha de vídeo principal
      "-map",      "0:a:0?",          // extrai apenas a trilha de áudio principal (opcional)
      "-vf",       vf.join(","),
      "-af",       `asetrate=${newSampleRate},aresample=44100`,
      "-c:v",      "libx264",
      "-preset",   "ultrafast",
      "-crf",      "19",              // CRF 19 = melhor que fonte (~CRF 23), sem double-compression
      "-c:a",      "aac",
      "-b:a",      "128k",
      "-map_metadata", "-1",          // remove todos os metadados do container
      "-metadata", `creation_time=${creationTime}`, // injeta data realista
      "-map_chapters", "-1",
      "-movflags", "+faststart",
      "-f",        "mp4",
    ];

    await new Promise<void>((resolve, reject) => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const cmd = ffmpeg(input)
        .outputOptions(outputOptions)
        .output(output)
        .on("end",   () => { clearTimeout(timer); resolve(); })
        .on("error", (err: Error) => { clearTimeout(timer); reject(new Error(`FFmpeg: ${err.message}`)); });
      cmd.run();
      timer = setTimeout(() => {
        try { (cmd as any).kill("SIGKILL"); } catch { /* ok */ }
        reject(new Error("FFmpeg timeout (>45s)"));
      }, 45_000);
    });

    // ── 7. Upload para Supabase Storage ──────────────────────────────────────
    const outputSizeMB = (fs.statSync(output).size / 1_048_576).toFixed(1);
    const publicUrl = await uploadToTemp(output, uid);

    const activeFx = [
      userEffects.mirror  ? "mirror"  : "",
      userEffects.invert  ? "invert"  : "",
      userEffects.zoom    ? "zoom"    : "",
      userEffects.blur    ? "blur"    : "",
      userEffects.noise   ? "noise+"  : "",
      userEffects.antiAi  ? "antiAi"  : "",
    ].filter(Boolean).join("+") || "base";

    console.log(
      `[process-videos] ✓ @${seed.slice(0, 8)} [${activeFx}] ` +
      `| ${inputSizeMB}MB → ${outputSizeMB}MB ` +
      `| pitch=${pitchFactor.toFixed(4)} noise=${noiseLuma} crf=19`
    );

    return publicUrl;

  } finally {
    for (const p of [input, output]) {
      try { fs.unlinkSync(p); } catch { /* ok */ }
    }
  }
}

// ── applyVideoEffects — wrapper de compatibilidade ───────────────────────────
// Chamado por publish-scheduled e posts/create.
// Se nenhum efeito criativo estiver ativo, retorna URL original sem re-encode.

export async function applyVideoEffects(
  videoUrl: string,
  opts: VideoEffectOptions
): Promise<string> {
  const hasActiveEffect =
    opts.mirror || opts.invert || opts.zoom ||
    opts.blur   || opts.noise  || opts.antiAi;

  if (!hasActiveEffect) return videoUrl;

  return processVideoForAccount(videoUrl, opts.accountId ?? "", {
    mirror: opts.mirror,
    invert: opts.invert,
    zoom:   opts.zoom,
    blur:   opts.blur,
    noise:  opts.noise,
    antiAi: opts.antiAi,
  });
}
