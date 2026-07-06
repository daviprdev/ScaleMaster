/**
 * /api/cron/process-videos
 *
 * Processa jobs da fila video_processing_jobs em batches de BATCH_SIZE.
 * Cada job roda FFmpeg com parâmetros únicos por conta (processVideoForAccount).
 *
 * Fluxo:
 *   1. Limpa jobs expirados
 *   2. Reclama BATCH_SIZE jobs queued → status='processing'
 *   3. Processa cada job sequencialmente (CPU completo por encode)
 *   4. Atualiza status='done' com output_url ou status='error'
 *
 * Separado do process-loops para que o FFmpeg nunca bloqueie o fluxo de postagem.
 * Com 5 jobs × ~20s = ~100s por run, bem dentro do limite de 300s.
 */

import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { processVideoForAccount } from "@/lib/video-effects";

export const runtime = "nodejs";
export const maxDuration = 300;

const BATCH_SIZE = 5;

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

  // ── Busca e reclama BATCH_SIZE jobs ─────────────────────────────────────────
  const { data: jobs, error: fetchErr } = await (admin as any)
    .from("video_processing_jobs")
    .select("id, account_id, video_id, source_url, effects, loop_id")
    .eq("status", "queued")
    .gt("expires_at", now.toISOString())
    .order("created_at", { ascending: true })
    .limit(BATCH_SIZE);

  if (fetchErr) {
    console.error("[process-videos] Erro ao buscar jobs:", fetchErr.message);
    return NextResponse.json({ error: fetchErr.message }, { status: 500 });
  }

  if (!jobs?.length) {
    console.log("[process-videos] Fila vazia — nenhum job pendente.");
    return NextResponse.json({ ok: true, processed: 0, errors: 0 });
  }

  // Marca como 'processing' atomicamente
  const jobIds = (jobs as JobRow[]).map(j => j.id);
  await (admin as any)
    .from("video_processing_jobs")
    .update({ status: "processing" })
    .in("id", jobIds);

  console.log(`[process-videos] Processando ${jobs.length} job(s)…`);

  let processed = 0;
  let errors    = 0;

  // ── Processa sequencialmente: cada encode tem CPU completo ──────────────────
  for (const job of jobs as JobRow[]) {
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

  return NextResponse.json({ ok: true, processed, errors, remaining });
}

