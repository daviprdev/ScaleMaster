/**
 * /api/cron/process-videos
 *
 * Processa jobs da fila video_processing_jobs até o orçamento de tempo (RUN_BUDGET_MS)
 * se esgotar. Cada job roda FFmpeg com parâmetros únicos por conta (processVideoForAccount).
 *
 * Fluxo:
 *   1. Limpa jobs expirados
 *   2. Reclama até FETCH_LIMIT jobs queued → status='processing'
 *   3. Processa sequencialmente (CPU completo por encode) enquanto sobrar orçamento
 *   4. Atualiza status='done' com output_url ou status='error'
 *   5. Jobs reclamados mas não alcançados (orçamento esgotou) voltam pra 'queued'
 *      na hora — não esperam os 10min do auto-healing.
 *
 * Separado do process-loops para que o FFmpeg nunca bloqueie o fluxo de postagem.
 *
 * Antes: BATCH_SIZE fixo de 5 job/run (~100s de um orçamento de 300s) — throughput
 * de 60 vídeos/hora artificialmente baixo (loops com 70+ contas levavam >1h só na
 * fila de FFmpeg). Fix (2026-07-27): processa até RUN_BUDGET_MS em vez de um teto
 * fixo de jobs — usa o orçamento de 300s quase inteiro por run, sem mudar a
 * frequência do cron (evita repetir o esgotamento de Disk IO do Supabase já visto
 * com crons mais frequentes).
 */

import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { processVideoForAccount } from "@/lib/video-effects";
import { prepareCleanMetadataVariant, cleanupStaleVariants } from "@/lib/video-processing";

export const runtime = "nodejs";
export const maxDuration = 300;

// Candidatos buscados por run — teto alto, o limite real é o orçamento de tempo abaixo.
const FETCH_LIMIT = 40;
// Margem de segurança abaixo do maxDuration=300s: um job em andamento pode levar até
// ~150s no pior caso (60s de download + 90s de timeout do FFmpeg), então paramos de
// INICIAR novos jobs bem antes do limite para não estourar a função no meio de um encode.
const RUN_BUDGET_MS = 200_000;

// ── Fase 1: variantes clean_metadata ───────────────────────────────
// Preparadas ANTES dos jobs de efeito: são stream copy (rápidas, ~5–20s) e
// destravam posts que estão esperando em `pending`. Orçamento próprio para que
// uma fila grande de variantes nunca deixe os efeitos sem tempo nenhum.
const VARIANT_BUDGET_MS = 90_000;
const VARIANT_FETCH_LIMIT = 10;

interface JobRow {
  id:         string;
  account_id: string;
  video_id:   string;
  source_url: string;
  effects:    {
    mirror?: boolean;
    invert?: boolean;
    zoom?:   boolean;
    blur?:   boolean;
    noise?:  boolean;
    antiAi?: boolean;
  };
  loop_id: string | null;
}

export async function GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization");
  if (!cronSecret) {
    console.warn("[cron] AVISO: CRON_SECRET nao configurado.");
  } else if (auth !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
    return NextResponse.json({ skipped: true, reason: "Supabase não configurado." });
  }

  const admin = getSupabaseAdmin();
  const now   = new Date();

  // ── Cleanup: remove jobs expirados ──────────────────────────────────────────
  try {
    const { count } = await (admin as any)
      .from("video_processing_jobs")
      .delete({ count: "exact" })
      .lt("expires_at", now.toISOString());
    if ((count ?? 0) > 0) {
      console.log(`[process-videos] 🗑️ ${count} job(s) expirado(s) removidos.`);
    }
  } catch (e) {
    console.warn("[process-videos] Falha ao limpar jobs expirados:", String(e));
  }

  // ── Auto-healing: desbloqueia jobs presos em 'processing' por >10 min ───────
  try {
    const stuckCutoff = new Date(now.getTime() - 10 * 60_000).toISOString();
    const { data: stuck } = await (admin as any)
      .from("video_processing_jobs")
      .update({ status: "queued" })
      .eq("status", "processing")
      .lt("created_at", stuckCutoff)
      .select("id");
    if (stuck?.length) {
      console.log(`[process-videos] ⚙️ ${stuck.length} job(s) travados resetados para queued.`);
    }
  } catch (e) {
    console.warn("[process-videos] Falha no auto-healing:", String(e));
  }

  // ══ FASE 1: variantes clean_metadata (opt-in do usuário) ════════════════
  const runStartGlobal = Date.now();
  let variantsDone = 0;
  let variantsFailed = 0;

  const { data: queuedVariants } = await (admin as any)
    .from("video_variants")
    .select("id, source_url, source_hash, attempts")
    .eq("status", "queued")
    .eq("processing_mode", "clean_metadata")
    .order("created_at", { ascending: true })
    .limit(VARIANT_FETCH_LIMIT);

  for (const variant of ((queuedVariants ?? []) as { id: string; source_url: string; source_hash: string; attempts: number | null }[])) {
    if (Date.now() - runStartGlobal > VARIANT_BUDGET_MS) {
      console.log("[process-videos] ⏱️ Orçamento de variantes esgotado — restante fica pro próximo ciclo.");
      break;
    }

    // Claim atômico: só uma invocação do cron processa cada variante.
    const { data: claimed } = await (admin as any)
      .from("video_variants")
      .update({ status: "processing", updated_at: new Date().toISOString() })
      .eq("id", variant.id)
      .eq("status", "queued")
      .select("id");
    if (!claimed?.length) continue;

    const result = await prepareCleanMetadataVariant(admin, variant);
    if (result.ok) variantsDone++;
    else {
      variantsFailed++;
      console.error(`[process-videos] ✗ variante ${variant.id.slice(0, 8)}: ${result.error.slice(0, 200)}`);
    }
  }

  // Auto-healing de variantes presas em "processing" (função morta no meio).
  try {
    const variantStuckCutoff = new Date(now.getTime() - 15 * 60_000).toISOString();
    await (admin as any)
      .from("video_variants")
      .update({ status: "queued" })
      .eq("status", "processing")
      .lt("updated_at", variantStuckCutoff);
  } catch (e) {
    console.warn("[process-videos] Falha no auto-healing de variantes:", String(e));
  }

  // Variantes são derivadas — sempre regeneráveis a partir do original.
  // Poda as ociosas para o Storage não crescer indefinidamente.
  try {
    await cleanupStaleVariants(admin);
  } catch (e) {
    console.warn("[process-videos] Falha na limpeza de variantes ociosas:", String(e));
  }

  if (variantsDone || variantsFailed) {
    console.log(`[process-videos] Variantes: ${variantsDone} pronta(s), ${variantsFailed} erro(s).`);
  }

  // ── Busca e reclama até FETCH_LIMIT jobs ────────────────────────────────────
  const { data: jobs, error: fetchErr } = await (admin as any)
    .from("video_processing_jobs")
    .select("id, account_id, video_id, source_url, effects, loop_id")
    .eq("status", "queued")
    .gt("expires_at", now.toISOString())
    .order("created_at", { ascending: true })
    .limit(FETCH_LIMIT);

  if (fetchErr) {
    console.error("[process-videos] Erro ao buscar jobs:", fetchErr.message);
    return NextResponse.json({ error: fetchErr.message }, { status: 500 });
  }

  if (!jobs?.length) {
    console.log("[process-videos] Fila de efeitos vazia — nenhum job pendente.");
    return NextResponse.json({
      ok: true, processed: 0, errors: 0,
      variants_done: variantsDone, variants_failed: variantsFailed,
    });
  }

  // CLAIM atômico: condiciona em status='queued' e processa SÓ o que esta
  // invocação conseguiu reivindicar. Sem o `.eq("status","queued")`, duas
  // execuções sobrepostas do cron (maxDuration=300s com schedule de 5 min)
  // reivindicavam os mesmos jobs e rodavam o mesmo FFmpeg duas vezes.
  const candidateIds = (jobs as JobRow[]).map(j => j.id);
  const { data: claimedRows } = await (admin as any)
    .from("video_processing_jobs")
    .update({ status: "processing" })
    .in("id", candidateIds)
    .eq("status", "queued")
    .select("id");

  const claimedIds = new Set(((claimedRows ?? []) as { id: string }[]).map(r => r.id));
  const claimedJobs = (jobs as JobRow[]).filter(j => claimedIds.has(j.id));

  if (claimedJobs.length === 0) {
    console.log("[process-videos] Nenhum job reivindicado (outra execução pegou primeiro).");
    return NextResponse.json({
      ok: true, processed: 0, errors: 0,
      variants_done: variantsDone, variants_failed: variantsFailed,
    });
  }

  console.log(`[process-videos] ${claimedJobs.length}/${jobs.length} job(s) reivindicado(s), processando até o orçamento de tempo…`);

  let processed = 0;
  let errors    = 0;
  const runStart = runStartGlobal;

  // ── Processa sequencialmente: cada encode tem CPU completo ──────────────────
  // Para de INICIAR novos jobs quando o orçamento estoura — o job em andamento
  // (se houver) sempre termina antes do maxDuration matar a função.
  for (let i = 0; i < claimedJobs.length; i++) {
    if (Date.now() - runStart > RUN_BUDGET_MS) {
      const remaining = claimedJobs.slice(i).map(j => j.id);
      await (admin as any)
        .from("video_processing_jobs")
        .update({ status: "queued" })
        .in("id", remaining);
      console.log(
        `[process-videos] ⏱️ Orçamento de tempo esgotado — ${remaining.length} job(s) devolvido(s) pra fila (sem esperar auto-healing).`
      );
      break;
    }

    const job = claimedJobs[i];
    const start = Date.now();
    try {
      const outputUrl = await processVideoForAccount(
        job.source_url,
        job.account_id,
        job.effects ?? {}
      );

      const elapsed = ((Date.now() - start) / 1000).toFixed(1);

      await (admin as any)
        .from("video_processing_jobs")
        .update({
          status:       "done",
          output_url:   outputUrl,
          processed_at: new Date().toISOString(),
          // expires_at: NÃO atualizado — preserva o valor inicial set por process-loops,
          // que já calcula max(2h, interval_minutes + 90min) para intervalos longos.
        })
        .eq("id", job.id);

      console.log(
        `[process-videos] ✓ job ${job.id.slice(0, 8)} | ` +
        `account ${job.account_id.slice(0, 8)} | ${elapsed}s`
      );
      processed++;

    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const elapsed = ((Date.now() - start) / 1000).toFixed(1);
      console.error(`[process-videos] ✗ job ${job.id.slice(0, 8)} (${elapsed}s): ${msg.slice(0, 200)}`);

      await (admin as any)
        .from("video_processing_jobs")
        .update({
          status:      "error",
          error_reason: msg.slice(0, 500),
        })
        .eq("id", job.id);

      errors++;
    }
  }

  // ── Resumo ──────────────────────────────────────────────────────────────────
  const { data: queueStats } = await (admin as any)
    .from("video_processing_jobs")
    .select("status", { count: "exact" })
    .gt("expires_at", now.toISOString());

  const remaining = (queueStats?.length ?? 0);
  console.log(
    `[process-videos] ■ Resumo: ${processed} ok, ${errors} erro(s). ` +
    `${remaining} job(s) restantes na fila.`
  );

  return NextResponse.json({
    ok: true, processed, errors, remaining,
    variants_done: variantsDone, variants_failed: variantsFailed,
  });
}

