/**
 * video-processing.ts — Processamento de vídeo OPT-IN por publicação.
 *
 * Arquitetura (2026-09-06):
 *
 *   ENTRADA (Inspirações / upload manual / Clone)  →  arquivo ORIGINAL  →  Biblioteca
 *   PUBLICAÇÃO  →  usuário escolhe o modo  →  Meta
 *
 *   mode = "original"        → videos_library.public_url vai direto pra Meta. ZERO FFmpeg.
 *   mode = "clean_metadata"  → uma VARIANTE separada (stream copy) é gerada uma única
 *                              vez por vídeo e reutilizada por todas as contas/publicações.
 *
 * O original NUNCA é sobrescrito: a variante vive em `variants/clean/v1/<hash>.mp4`
 * e o vínculo fica em `video_variants`. Dedup por (source_hash, mode, version).
 *
 * A preparação é ASSÍNCRONA por padrão: quem publica chama `resolveMediaUrlForMode`,
 * que devolve `pending` e enfileira a variante. O cron process-videos prepara.
 * O post continua `pending` e é republicado no ciclo seguinte — nunca vira falha.
 */

import * as crypto from "crypto";
import * as fs from "fs";
import { downloadAndCleanMetadata } from "@/lib/ffmpeg-process";

export type VideoProcessingMode = "original" | "clean_metadata";

export const VIDEO_PROCESSING_MODES: readonly VideoProcessingMode[] = [
  "original",
  "clean_metadata",
] as const;

export const DEFAULT_VIDEO_PROCESSING_MODE: VideoProcessingMode = "original";

/** Versão do pipeline de limpeza. Mudar aqui invalida (regenera) todas as variantes. */
export const CLEAN_METADATA_VERSION = 1;

const VARIANT_BUCKET = "videos-library";
const VARIANT_PREFIX = "variants/clean";
/**
 * Tentativas de preparo antes da variante virar erro TERMINAL.
 *
 * Depois disso a publicação NÃO acontece: `clean_metadata` nunca cai para
 * `original` por conta própria. Publicar o original seria trocar em silêncio a
 * escolha do usuário pelo oposto exato dela.
 */
const MAX_VARIANT_ATTEMPTS = 3;

// Cliente admin do Supabase. As tabelas novas (video_variants) nao existem nos
// tipos gerados, entao o tipo permissivo aqui segue o padrao ja usado nos crons.
type Admin = ReturnType<typeof import("@/lib/supabase").getSupabaseAdmin> & {
  from: (table: string) => any;
  storage: { from: (bucket: string) => any };
};

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Aceita só valores conhecidos; qualquer outra coisa (null, legado, lixo) vira "original". */
export function normalizeProcessingMode(value: unknown): VideoProcessingMode {
  return value === "clean_metadata" ? "clean_metadata" : "original";
}

/** Imagens (Stories) não passam por FFmpeg em nenhum modo. */
export function isImageMedia(url: string): boolean {
  const clean = url.toLowerCase().split("?")[0];
  return clean.endsWith(".jpg") || clean.endsWith(".jpeg") || clean.endsWith(".png");
}

/** Identidade da fonte para dedup — a URL do original é estável (original é imutável). */
export function sourceHash(url: string): string {
  return crypto.createHash("sha256").update(url).digest("hex");
}

function variantStoragePath(hash: string): string {
  return `${VARIANT_PREFIX}/v${CLEAN_METADATA_VERSION}/${hash.slice(0, 32)}.mp4`;
}

/** Log padronizado de observabilidade — sem URLs completas nem tokens. */
export function logVideoProcessing(
  scope: string,
  mode: VideoProcessingMode,
  detail: Record<string, string | number | boolean | null | undefined> = {}
): void {
  const extra = Object.entries(detail)
    .filter(([, v]) => v !== undefined && v !== null && v !== "")
    .map(([k, v]) => `${k}=${v}`)
    .join(" ");
  console.log(`[video-processing] ${scope} mode=${mode}${extra ? ` ${extra}` : ""}`);
}

// ── Resolução da URL a publicar ──────────────────────────────────────────────

export type MediaResolution =
  /** Pode publicar: `url` e o arquivo correto para o modo pedido. */
  | { status: "ready"; url: string; mode: VideoProcessingMode; variantId: string | null }
  /** Ainda nao da para publicar; tente no proximo ciclo. O post continua na fila. */
  | { status: "pending"; variantId: string | null; reason: string }
  /** Falha terminal do preparo. NAO publicar — nem a variante, nem o original. */
  | { status: "error"; variantId: string | null; reason: string };

export interface ResolveOptions {
  mode: VideoProcessingMode;
  /** URL do arquivo ORIGINAL (Supabase Storage / URL já re-hospedada). */
  sourceUrl: string;
  sourceVideoId?: string | null;
  userId?: string | null;
  /** Contexto para o log (ex.: "loop-cron @conta"). */
  scope?: string;
}

/**
 * Decide qual URL usar na publicação.
 *
 * mode="original" → devolve a propria URL. Nenhuma chamada de rede, nenhum FFmpeg.
 * mode="clean_metadata" → devolve a variante pronta, `pending` (enfileirando-a) ou
 *   `error` quando o preparo falhou em definitivo.
 *
 * NUNCA devolve a URL original quando o modo pedido e `clean_metadata`: a escolha
 * persistida no post e soberana, e o fallback silencioso publicaria exatamente o
 * arquivo que o usuario pediu para nao publicar.
 */
export async function resolveMediaUrlForMode(
  admin: Admin,
  opts: ResolveOptions
): Promise<MediaResolution> {
  const { mode, sourceUrl, sourceVideoId = null, userId = null, scope = "publish" } = opts;

  if (mode === "original") {
    logVideoProcessing(scope, "original");
    return { status: "ready", url: sourceUrl, mode: "original", variantId: null };
  }

  // Imagem (Story de foto): NAO e fallback por falha — e o tipo de midia que nao
  // tem trilha de video para fazer stream copy. A limpeza simplesmente nao se
  // aplica, entao a imagem segue como esta.
  if (isImageMedia(sourceUrl)) {
    logVideoProcessing(scope, "clean_metadata", { aplicado: "nao-se-aplica-a-imagem" });
    return { status: "ready", url: sourceUrl, mode: "clean_metadata", variantId: null };
  }

  const hash = sourceHash(sourceUrl);

  const { data: existing } = await admin
    .from("video_variants")
    .select("id, status, public_url, attempts, error_reason")
    .eq("source_hash", hash)
    .eq("processing_mode", "clean_metadata")
    .eq("processing_version", CLEAN_METADATA_VERSION)
    .maybeSingle();

  if (existing?.status === "ready" && existing.public_url) {
    // last_used_at alimenta a limpeza de variantes ociosas (ver cleanupStaleVariants).
    await admin
      .from("video_variants")
      .update({ last_used_at: new Date().toISOString() })
      .eq("id", existing.id);
    logVideoProcessing(scope, "clean_metadata", { variant: existing.id.slice(0, 8), reuse: true });
    return { status: "ready", url: existing.public_url, mode: "clean_metadata", variantId: existing.id };
  }

  if (existing?.status === "error" && (existing.attempts ?? 0) >= MAX_VARIANT_ATTEMPTS) {
    // Falha TERMINAL: a publicacao fica bloqueada. O original NAO entra no lugar.
    const attempts = existing.attempts ?? 0;
    console.warn(
      `[video-processing] ${scope} mode=clean_metadata status=error attempt=${attempts} ` +
      `variant=${existing.id.slice(0, 8)} — publicacao bloqueada (o original nunca substitui a versao limpa).`
    );
    return {
      status: "error",
      variantId: existing.id,
      reason:
        `falha ao preparar a versao limpa apos ${attempts} tentativa(s)` +
        (existing.error_reason ? `: ${String(existing.error_reason).slice(0, 200)}` : ""),
    };
  }

  if (existing?.status === "error") {
    // Retry controlado: `attempts` ja foi incrementado pelo worker e o teto acima
    // encerra o ciclo. Aqui a variante so volta para a fila.
    const attempts = existing.attempts ?? 0;
    await admin
      .from("video_variants")
      .update({ status: "queued", updated_at: new Date().toISOString() })
      .eq("id", existing.id);
    logVideoProcessing(scope, "clean_metadata", {
      variant: existing.id.slice(0, 8),
      retry: `${attempts}/${MAX_VARIANT_ATTEMPTS}`,
    });
    return {
      status: "pending",
      variantId: existing.id,
      reason: `nova tentativa de limpeza (${attempts}/${MAX_VARIANT_ATTEMPTS})`,
    };
  }

  if (existing) {
    return { status: "pending", variantId: existing.id, reason: `variante ${existing.status}` };
  }

  // Enfileira. Corrida entre dois crons é resolvida pelo índice único de dedup.
  const { data: created, error: insertErr } = await admin
    .from("video_variants")
    .insert({
      user_id: userId,
      source_video_id: sourceVideoId,
      source_url: sourceUrl,
      source_hash: hash,
      processing_mode: "clean_metadata",
      processing_version: CLEAN_METADATA_VERSION,
      status: "queued",
    })
    .select("id")
    .single();

  if (insertErr) {
    const { data: raced } = await admin
      .from("video_variants")
      .select("id, status, public_url")
      .eq("source_hash", hash)
      .eq("processing_mode", "clean_metadata")
      .eq("processing_version", CLEAN_METADATA_VERSION)
      .maybeSingle();
    if (raced?.status === "ready" && raced.public_url) {
      logVideoProcessing(scope, "clean_metadata", { variant: raced.id.slice(0, 8), reuse: true });
      return { status: "ready", url: raced.public_url, mode: "clean_metadata", variantId: raced.id };
    }
    if (raced) return { status: "pending", variantId: raced.id, reason: `variante ${raced.status}` };
    console.warn(`[video-processing] ${scope}: falha ao enfileirar variante: ${insertErr.message}`);
    return { status: "pending", variantId: null, reason: "falha ao enfileirar variante" };
  }

  logVideoProcessing(scope, "clean_metadata", { variant: created.id.slice(0, 8), queued: true });
  return { status: "pending", variantId: created.id, reason: "variante enfileirada" };
}

/**
 * Versao SINCRONA de `resolveMediaUrlForMode`, para os fluxos em que existe um
 * usuario esperando a resposta (publicacao imediata na aba Postar).
 *
 * Se a variante ainda nao existe, prepara na hora (stream copy, rapido) em vez
 * de devolver `pending`. Se a preparacao falhar, devolve `{ ok: false }` — quem
 * chama reporta o erro ao usuario. NUNCA publica o original no lugar da versao
 * limpa: isso trocaria em silencio a escolha do usuario pelo oposto dela.
 *
 * NAO usar nos crons de publicacao: la o FFmpeg fica fora do caminho critico
 * (o projeto ja teve starvation/timeout por processar video na hora de publicar).
 */
export async function resolveMediaUrlNow(
  admin: Admin,
  opts: ResolveOptions
): Promise<{ ok: true; url: string; mode: VideoProcessingMode } | { ok: false; reason: string }> {
  const resolution = await resolveMediaUrlForMode(admin, opts);
  if (resolution.status === "ready") {
    return { ok: true, url: resolution.url, mode: resolution.mode };
  }
  if (resolution.status === "error") {
    return { ok: false, reason: resolution.reason };
  }

  if (resolution.variantId) {
    const { data: variant } = await admin
      .from("video_variants")
      .select("id, source_url, source_hash, attempts, status, public_url")
      .eq("id", resolution.variantId)
      .maybeSingle();

    if (variant?.status === "ready" && variant.public_url) {
      return { ok: true, url: variant.public_url, mode: "clean_metadata" };
    }

    if (variant) {
      const { data: claimed } = await admin
        .from("video_variants")
        .update({ status: "processing", updated_at: new Date().toISOString() })
        .eq("id", variant.id)
        .eq("status", "queued")
        .select("id");

      if (claimed?.length) {
        const result = await prepareCleanMetadataVariant(admin, variant);
        if (result.ok) return { ok: true, url: result.publicUrl, mode: "clean_metadata" };
        console.warn(
          `[video-processing] ${opts.scope ?? "publish"} mode=clean_metadata status=error ` +
          `attempt=${(variant.attempts ?? 0) + 1} variant=${variant.id.slice(0, 8)} — publicacao bloqueada.`
        );
        return { ok: false, reason: `falha ao preparar a versao limpa: ${result.error.slice(0, 200)}` };
      }
    }
  }

  // Outra invocacao esta preparando a mesma variante agora.
  return {
    ok: false,
    reason: "a versao limpa deste video ainda esta sendo preparada — tente de novo em instantes",
  };
}

// ── Worker ───────────────────────────────────────────────────────────────────

export interface VariantRow {
  id: string;
  source_url: string;
  source_hash: string;
  attempts: number | null;
}

/**
 * Gera a variante clean_metadata: download → stream copy → upload em `variants/`.
 * O arquivo ORIGINAL não é tocado em momento algum.
 */
export async function prepareCleanMetadataVariant(
  admin: Admin,
  variant: VariantRow
): Promise<{ ok: true; publicUrl: string } | { ok: false; error: string }> {
  const attempts = (variant.attempts ?? 0) + 1;
  const storagePath = variantStoragePath(variant.source_hash);
  let cleanup: (() => void) | null = null;

  try {
    const result = await downloadAndCleanMetadata(variant.source_url);
    cleanup = result.cleanup;
    const buf = fs.readFileSync(result.outputPath);

    const { error: upErr } = await admin.storage
      .from(VARIANT_BUCKET)
      .upload(storagePath, buf, { contentType: "video/mp4", upsert: true });
    if (upErr) throw new Error(`Storage: ${upErr.message}`);

    const { data: urlData } = admin.storage.from(VARIANT_BUCKET).getPublicUrl(storagePath);

    await admin
      .from("video_variants")
      .update({
        status: "ready",
        storage_path: storagePath,
        public_url: urlData.publicUrl,
        file_size: result.fileSize,
        error_reason: null,
        attempts,
        ready_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        last_used_at: new Date().toISOString(),
      })
      .eq("id", variant.id);

    logVideoProcessing("variant-worker", "clean_metadata", {
      variant: variant.id.slice(0, 8),
      mb: (result.fileSize / 1_048_576).toFixed(1),
    });
    return { ok: true, publicUrl: urlData.publicUrl };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await admin
      .from("video_variants")
      .update({
        status: "error",
        error_reason: msg.slice(0, 500),
        attempts,
        updated_at: new Date().toISOString(),
      })
      .eq("id", variant.id);
    return { ok: false, error: msg };
  } finally {
    cleanup?.();
  }
}

/**
 * Remove variantes ociosas (não usadas há `days` dias) e o arquivo correspondente.
 * As variantes são derivadas — sempre podem ser regeradas a partir do original.
 * Existe porque o projeto já teve um incidente de 391 GB de arquivos derivados
 * acumulados no Storage (2026-08-08).
 */
export async function cleanupStaleVariants(admin: Admin, days = 21, limit = 50): Promise<number> {
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60_000).toISOString();
  const { data: stale } = await admin
    .from("video_variants")
    .select("id, storage_path")
    .lt("last_used_at", cutoff)
    .limit(limit);

  const rows = (stale ?? []) as { id: string; storage_path: string | null }[];
  if (rows.length === 0) return 0;

  const paths = rows.map((r) => r.storage_path).filter(Boolean) as string[];
  if (paths.length) {
    await admin.storage.from(VARIANT_BUCKET).remove(paths);
  }
  await admin.from("video_variants").delete().in("id", rows.map((r) => r.id));
  console.log(`[video-processing] cleanup: ${rows.length} variante(s) ociosa(s) removida(s).`);
  return rows.length;
}
