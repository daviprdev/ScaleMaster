/**
 * video-effects.ts - Pipeline dos EFEITOS CRIATIVOS do Loop.
 *
 * ESCOPO (2026-09-06): roda EXCLUSIVAMENTE quando o usuario liga ao menos um
 * efeito criativo no painel do Loop (espelhar, inverter, zoom, blur, ruido,
 * anti-IA, texto na tela). Sem efeito ativo, nenhum job e enfileirado e este arquivo nunca e
 * executado - o video original vai direto pra Meta.
 *
 * E um conceito DIFERENTE de "Processamento do video" (original vs
 * clean_metadata, em lib/video-processing.ts): efeito criativo altera imagem e
 * audio, entao re-encoda por definicao. Limpeza de metadados nunca re-encoda.
 *
 * Chamado apenas pelo cron process-videos, que consome a fila
 * video_processing_jobs preenchida pelo process-loops.
 *
 * O que o pipeline faz por conta (parametros deterministicos via FNV-1a do account_id):
 *   - eq contrast/brightness/saturation +-2%
 *   - noise luma c0s=2-4
 *   - asetrate pitch +-1%
 *   - libx264 CRF 22 ultrafast
 *   - -map_metadata -1 (remove metadados da entrada; nada artificial e adicionado)
 *   - efeitos criativos do usuario: hflip, negate, zoom, blur, noise+, antiAi
 *
 * Texto na tela (2026-10-19, lib/video-text-overlay.ts): a frase escolhida pelo
 * process-loops chega pronta no payload e e queimada por ultimo (drawtext), por
 * cima de espelho/cor/ruido. Ligado SOZINHO, o encode e limpo: sem eq/ruido/
 * pitch, CRF 20 veryfast, yuv420p, AAC 48 kHz e bitrate maximo pela duracao
 * para caber no teto de 50 MB do Storage.
 */

import ffmpeg from "fluent-ffmpeg";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import * as crypto from "crypto";
import { getSupabaseAdmin } from "@/lib/supabase";
import { FFMPEG_INPUT_OPTIONS } from "@/lib/ffmpeg-input";
import { fetchMediaBytes } from "@/lib/media-ingest";
import {
  buildDrawtextFilter,
  fnv1a,
  layoutTextOverlay,
  normalizeTextPosition,
  sanitizeOverlayText,
} from "@/lib/video-text-overlay";

// Limite de upload do bucket videos-library.
const STORAGE_LIMIT_BYTES = 50 * 1024 * 1024;

// ── Texto na tela: fonte e dimensões do vídeo ───────────────────────────────

const OVERLAY_FONT_CANDIDATES = [
  process.env.OVERLAY_FONT_FILE,
  "/usr/share/fonts/dejavu/DejaVuSans-Bold.ttf",          // Alpine (font-dejavu, Dockerfile do app)
  "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", // Debian/Ubuntu (fonts-dejavu-core)
  "C:\\Windows\\Fonts\\arialbd.ttf",                      // desenvolvimento no Windows
];

function resolveOverlayFont(): string {
  const font = OVERLAY_FONT_CANDIDATES.find((p): p is string => !!p && fs.existsSync(p));
  if (!font) {
    throw new Error("Texto na tela: nenhuma fonte TTF no servidor (instale font-dejavu ou defina OVERLAY_FONT_FILE).");
  }
  return font;
}

interface ProbedVideo {
  width?:    number;
  height?:   number;
  duration?: number;
}

/** Dimensões exibidas (rotação aplicada) e duração. Falha → {} e o layout usa 720x1280. */
function probeVideo(file: string): Promise<ProbedVideo> {
  return new Promise((resolve) => {
    ffmpeg.ffprobe(file, FFMPEG_INPUT_OPTIONS, (err, data) => {
      if (err || !data) return resolve({});
      const v = data.streams.find((s) => s.codec_type === "video");
      const sideRotation = (v as { side_data_list?: { rotation?: number }[] } | undefined)
        ?.side_data_list?.find((d) => d.rotation !== undefined)?.rotation;
      const rotation = Math.abs(Number(sideRotation ?? v?.tags?.rotate ?? 0)) % 180;
      const duration = Number(data.format?.duration);
      resolve({
        width:    rotation === 90 ? v?.height : v?.width,
        height:   rotation === 90 ? v?.width : v?.height,
        duration: Number.isFinite(duration) && duration > 0 ? duration : undefined,
      });
    });
  });
}

/** Teto de bitrate do encode limpo: 45 MB no total (folga sob os 50 MB). */
function cleanMaxrateKbps(duration?: number): number {
  if (!duration) return 4000;
  const budget = (45 * 8 * 1024 * 1024) / 1000 / duration - 160; // - áudio 128k + mux
  return Math.max(800, Math.min(6000, Math.floor(budget)));
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
 *   eq + noise luma + pitch shift de áudio + CRF 22
 *
 * Efeitos criativos (opcionais, ativados no painel do Loop):
 *   mirror, invert, zoom, blur, noise+, antiAi, text (Texto na tela)
 *
 * Só o texto ligado → encode limpo, sem a base anti-fingerprint (ver topo).
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
    /** Frase já escolhida pelo process-loops (fica no job: retry não troca). */
    text?:   string;
    textPosition?: string;
  } = {}
): Promise<string> {
  const tmpDir = os.tmpdir();
  const uid    = crypto.randomUUID();
  const input  = path.join(tmpDir, `vpf_in_${uid}.mp4`);
  const output = path.join(tmpDir, `vpf_out_${uid}.mp4`);
  const textFile = path.join(tmpDir, `vpf_txt_${uid}.txt`);

  const overlayText = sanitizeOverlayText(userEffects.text ?? "");
  const hasLegacyFx = !!(
    userEffects.mirror || userEffects.invert || userEffects.zoom ||
    userEffects.blur   || userEffects.noise  || userEffects.antiAi
  );
  const cleanEncode = overlayText.length > 0 && !hasLegacyFx;

  try {
    // ── 1. Download ──────────────────────────────────────────────────────────
    // Allowlist de origem reavaliada a cada redirect + teto de 250 MB (SSRF/DoS),
    // via undici (o fetch global patcheado do Next.js 15 corrompe binários).
    // Sem User-Agent de CDN: o source_url é o Storage do Supabase, e o padrão
    // do undici é o que sempre funcionou aqui.
    const inputBuf = await fetchMediaBytes(videoUrl, { timeoutMs: 60_000, headers: {} });
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
      // Aritmética 20/23 garante dimensão par (exigência do yuv420p).
      vf.push(
        "scale=trunc(iw*23/40)*2:trunc(ih*23/40)*2," +
        "crop=trunc(iw*20/46)*2:trunc(ih*20/46)*2:(iw-trunc(iw*20/46)*2)/2:(ih-trunc(ih*20/46)*2)/2"
      );
    }
    if (userEffects.blur) vf.push("smartblur=lr=1:ls=0.25:lt=0");

    // Só o Texto na tela ligado: nada de eq/ruído/pitch, que só degradam a
    // imagem — o texto próprio é o que diferencia o vídeo.
    const noiseLuma = userEffects.noise ? noiseLevel + 2 : noiseLevel; // noise ativo = mais intenso
    if (!cleanEncode) {
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
      // c0f=u: seed fixo por frame (no FFmpeg 4.1 as flags temporais causavam ERANGE)
      vf.push(`noise=c0s=${noiseLuma}:c0f=u`);
    }

    // Texto na tela: por último, para não sair espelhado, invertido nem granulado.
    // O texto vai num arquivo (textfile + expansion=none): nada do usuário passa
    // pelo parser de filtros do FFmpeg.
    let probed: ProbedVideo = {};
    if (overlayText) {
      probed = await probeVideo(input);
      const layout = layoutTextOverlay(overlayText, probed);
      fs.writeFileSync(textFile, layout.lines.join("\n"), "utf8");
      const fontFile = resolveOverlayFont();
      // fluent-ffmpeg quebra em dois argumentos uma opção com espaço.
      if (/\s/.test(fontFile + textFile)) {
        throw new Error(`Texto na tela: caminho com espaço não suportado (${fontFile} / ${textFile}).`);
      }
      vf.push(buildDrawtextFilter({
        fontFile,
        textFile,
        layout,
        position: normalizeTextPosition(userEffects.textPosition),
      }));
    }

    // ── 4. Filtro de áudio: pitch único por conta (quebra Chromaprint/AudID) ─
    const newSampleRate = Math.round(44100 * pitchFactor);

    // ── 5. Encode ────────────────────────────────────────────────────────────
    const cleanMaxrate = cleanMaxrateKbps(probed.duration);
    const outputOptions: string[] = cleanEncode
      ? [
        "-map",      "0:v:0",
        "-map",      "0:a:0?",
        "-vf",       vf.join(","),
        "-c:v",      "libx264",
        // veryfast leva ~0,6x a duração em 720p com 1,5 vCPU (medido na VPS);
        // vídeo longo cai para superfast e continua dentro do timeout de 90s.
        "-preset",   probed.duration && probed.duration > 75 ? "superfast" : "veryfast",
        "-crf",      "20",
        "-pix_fmt",  "yuv420p",
        "-maxrate",  `${cleanMaxrate}k`, // pela duração: saída <= 45 MB (50 MB = limite upload Supabase)
        "-bufsize",  `${cleanMaxrate * 2}k`,
        "-c:a",      "aac",
        "-b:a",      "128k",
        "-ar",       "48000",
        "-map_metadata", "-1",
        "-map_chapters", "-1",
        "-movflags", "+faststart",
        "-f",        "mp4",
      ]
      : [
        "-map",      "0:v:0",           // extrai apenas a trilha de vídeo principal
        "-map",      "0:a:0?",          // extrai apenas a trilha de áudio principal (opcional)
        "-vf",       vf.join(","),
        "-af",       `asetrate=${newSampleRate},aresample=44100`,
        "-c:v",      "libx264",
        "-preset",   "ultrafast",
        "-crf",      "22",
        "-maxrate",  "4M",             // cap de bitrate: reels até 90s ficam < 45 MB (50 MB = limite upload Supabase)
        "-bufsize",  "8M",
        "-c:a",      "aac",
        "-b:a",      "128k",
        // Remove os metadados do arquivo de ENTRADA (o FFmpeg os copiaria por
        // padrao para a saida). Nao existe nenhum "-metadata" adicionado aqui:
        // o pipeline nao inventa creation_time, UUID nem qualquer outro campo
        // artificial — so aplica os efeitos que o usuario selecionou.
        "-map_metadata", "-1",
        "-map_chapters", "-1",
        "-movflags", "+faststart",
        "-f",        "mp4",
      ];

    await new Promise<void>((resolve, reject) => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const cmd = ffmpeg(input)
        .inputOptions(FFMPEG_INPUT_OPTIONS)
        .outputOptions(outputOptions)
        .output(output)
        .on("end",   () => { clearTimeout(timer); resolve(); })
        .on("error", (err: Error) => { clearTimeout(timer); reject(new Error(`FFmpeg: ${err.message}`)); });
      cmd.run();
      timer = setTimeout(() => {
        try { (cmd as any).kill("SIGKILL"); } catch { /* ok */ }
        reject(new Error("FFmpeg timeout (>90s)"));
      }, 90_000);
    });

    // ── 7. Upload para Supabase Storage ──────────────────────────────────────
    const outputBytes = fs.statSync(output).size;
    const outputSizeMB = (outputBytes / 1_048_576).toFixed(1);
    if (outputBytes > STORAGE_LIMIT_BYTES) {
      throw new Error(`Vídeo processado com ${outputSizeMB} MB passa do limite de 50 MB do Storage.`);
    }
    const publicUrl = await uploadToTemp(output, uid);

    const activeFx = [
      userEffects.mirror  ? "mirror"  : "",
      userEffects.invert  ? "invert"  : "",
      userEffects.zoom    ? "zoom"    : "",
      userEffects.blur    ? "blur"    : "",
      userEffects.noise   ? "noise+"  : "",
      userEffects.antiAi  ? "antiAi"  : "",
      overlayText         ? "text"    : "",
    ].filter(Boolean).join("+") || "base";

    console.log(
      `[process-videos] ✓ @${seed.slice(0, 8)} [${activeFx}] ` +
      `| ${inputSizeMB}MB → ${outputSizeMB}MB ` +
      (cleanEncode
        ? `| clean crf=20 maxrate=${cleanMaxrate}k`
        : `| pitch=${pitchFactor.toFixed(4)} noise=${noiseLuma} crf=22`)
    );

    return publicUrl;

  } finally {
    for (const p of [input, output, textFile]) {
      try { fs.unlinkSync(p); } catch { /* ok */ }
    }
  }
}

// applyVideoEffects foi removido em 2026-09-06: era um wrapper orfao (zero call
// sites desde 08/07/2026) e mantinha viva a ideia de que algum fluxo de
// postagem chamaria efeitos automaticamente. Os efeitos continuam intactos em
// processVideoForAccount, acionados so pela fila do Loop.
