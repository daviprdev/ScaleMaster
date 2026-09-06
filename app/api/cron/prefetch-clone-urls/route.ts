import { NextRequest, NextResponse } from "next/server";
import { ApifyClient } from "apify-client";
import { fetch as undiciFetch } from "undici";
import { resolveApifyTokens } from "@/lib/apify-token-pool";
import { getSupabaseAdmin } from "@/lib/supabase";
import { requireCronAuth } from "@/lib/cron-auth";

export const runtime = "nodejs";
export const maxDuration = 300;

// Budget conservador — Vercel Hobby corta em 60s real
const BUDGET_MS = 54_000;
// Máximo de downloads+uploads por ciclo (cada um leva 10–25s)
const MAX_DOWNLOADS_PER_RUN = 2;
// Máximo de novos runs Apify iniciados por ciclo (cada início leva ~1s)
const MAX_NEW_RUNS = 8;

// ── Marcador temporário em error_message para rastrear runs ──────────────────
// Formato: "[APIFY_RUN:{runId}]"
// Prefetch cron lê + limpa; publish-scheduled ignora posts com esse marcador.
const RUN_MARKER_PREFIX = "[APIFY_RUN:";
const RUN_MARKER_SUFFIX = "]";

function makeMarker(runId: string) {
  return `${RUN_MARKER_PREFIX}${runId}${RUN_MARKER_SUFFIX}`;
}

function extractRunId(marker: string): string | null {
  if (!marker.startsWith(RUN_MARKER_PREFIX)) return null;
  return marker.slice(RUN_MARKER_PREFIX.length, -RUN_MARKER_SUFFIX.length) || null;
}

function isCloneUrl(url: string): boolean {
  return url.includes("instagram.com/reel/") || url.includes("instagram.com/p/");
}

// ── Polling de run existente ──────────────────────────────────────────────────
async function getRunStatus(runId: string): Promise<{
  status: string;
  client: ApifyClient;
  defaultDatasetId: string | null;
} | null> {
  const tokens = resolveApifyTokens();
  for (const token of tokens) {
    try {
      const client = new ApifyClient({ token });
      const run = await client.run(runId).get();
      if (run) {
        return {
          status: run.status as string,
          client,
          defaultDatasetId: (run.defaultDatasetId as string | null) ?? null,
        };
      }
    } catch { /* token errado ou run não encontrado neste token */ }
  }
  return null;
}

// ── Download CDN + upload Supabase ────────────────────────────────────────────
async function downloadAndHost(cdnUrl: string, postId: string): Promise<string> {
  const admin = getSupabaseAdmin();

  const fetchInit: Parameters<typeof undiciFetch>[1] = {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
      "Referer": "https://www.instagram.com/",
    },
    signal: AbortSignal.timeout(25_000),
  };
  const res = await undiciFetch(cdnUrl, fetchInit);

  if (!res.ok) throw new Error(`CDN respondeu HTTP ${res.status}`);

  const ct = res.headers.get("content-type") ?? "";
  if (ct && !ct.includes("video/") && !ct.includes("octet-stream") && !ct.includes("binary/")) {
    throw new Error(`conteúdo inválido do CDN: ${ct.slice(0, 50)}`);
  }

  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < 50_000) throw new Error(`arquivo muito pequeno: ${buf.length} bytes`);

  const storagePath = `temp/clone_${postId}.mp4`;
  const { error } = await admin.storage
    .from("videos-library")
    .upload(storagePath, buf, { contentType: "video/mp4", upsert: true });
  if (error) throw new Error(`upload Supabase: ${error.message}`);

  const { data } = admin.storage.from("videos-library").getPublicUrl(storagePath);
  console.log(
    `[prefetch] ✓ Hospedado: ${(buf.length / 1_048_576).toFixed(1)}MB → ${data.publicUrl.slice(0, 70)}…`
  );
  return data.publicUrl;
}

export async function GET(req: NextRequest) {
  const runStart = Date.now();
  const elapsed = () => Date.now() - runStart;
  const budgetOk = (reserveMs = 3_000) => elapsed() < BUDGET_MS - reserveMs;

  const cronAuth = requireCronAuth(req);
  if (!cronAuth.ok) return cronAuth.response;
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
    return NextResponse.json({ skipped: true, reason: "Supabase não configurado." });
  }

  const admin = getSupabaseAdmin();
  const summary = { checked: 0, resolved: 0, started: 0, cleared: 0, failed: 0 };

  console.log(`[prefetch] ▶ Iniciando. budget=${BUDGET_MS / 1000}s`);

  // ═══════════════════════════════════════════════════════════════════════════
  // FASE 1 — Verificar runs Apify em andamento
  // Posts marcados com error_message = "[APIFY_RUN:{runId}]"
  // ═══════════════════════════════════════════════════════════════════════════
  const { data: markedPosts } = await admin
    .from("scheduled_posts")
    .select("id, video_url, error_message")
    .eq("status", "pending")
    .like("error_message", `${RUN_MARKER_PREFIX}%`)
    .limit(30);

  // Deduplica por run_id (vários posts podem ter o mesmo marcador)
  const runMap = new Map<string, { postId: string; instagramUrl: string }>();
  for (const p of markedPosts ?? []) {
    const runId = extractRunId(p.error_message as string);
    if (runId && !runMap.has(runId)) {
      runMap.set(runId, { postId: p.id as string, instagramUrl: p.video_url as string });
    }
  }

  // URLs que já têm run em andamento (para excluir da Fase 2)
  const urlsWithRun = new Set((markedPosts ?? []).map(p => p.video_url as string));

  let downloadsThisRun = 0;

  for (const [runId, { postId, instagramUrl }] of runMap) {
    if (!budgetOk(28_000)) break; // precisa de margem para 1 download

    summary.checked++;
    const found = await getRunStatus(runId);

    if (!found) {
      // Run não encontrado em nenhum token → limpa marcador
      await admin
        .from("scheduled_posts")
        .update({ error_message: null })
        .eq("status", "pending")
        .like("error_message", `${RUN_MARKER_PREFIX}${runId}${RUN_MARKER_SUFFIX}`);
      urlsWithRun.delete(instagramUrl);
      summary.cleared++;
      console.log(`[prefetch] ⚠ Run ${runId.slice(0, 12)}… não encontrado — limpo.`);
      continue;
    }

    const { status, client, defaultDatasetId } = found;

    if (["RUNNING", "READY", "CREATED"].includes(status)) {
      console.log(`[prefetch] ⏳ Run ${runId.slice(0, 12)}… ainda ${status} — aguardando.`);
      continue;
    }

    if (["FAILED", "ABORTED", "TIMED-OUT"].includes(status)) {
      await admin
        .from("scheduled_posts")
        .update({ error_message: null })
        .eq("status", "pending")
        .like("error_message", `${RUN_MARKER_PREFIX}${runId}${RUN_MARKER_SUFFIX}`);
      urlsWithRun.delete(instagramUrl);
      summary.cleared++;
      console.warn(`[prefetch] ✗ Run ${runId.slice(0, 12)}… ${status} — limpo para retry.`);
      continue;
    }

    if (status === "SUCCEEDED") {
      if (downloadsThisRun >= MAX_DOWNLOADS_PER_RUN || !budgetOk(27_000)) {
        console.log(
          `[prefetch] ⏭ Run ${runId.slice(0, 12)}… SUCCEEDED mas ${downloadsThisRun >= MAX_DOWNLOADS_PER_RUN ? "download limit" : "budget"} — próximo ciclo.`
        );
        continue;
      }

      try {
        const { items } = await client.dataset(defaultDatasetId!).listItems();
        const item = (items as Record<string, unknown>[])[0];
        if (!item) throw new Error("dataset vazio");

        const cdnUrl =
          (item.videoUrl as string | undefined) ||
          (item.video_url as string | undefined) ||
          (item.videoPlayUrl as string | undefined) ||
          (item.playVideoUrl as string | undefined) ||
          "";
        if (!cdnUrl) throw new Error("item sem campo videoUrl");

        downloadsThisRun++;
        const supabaseUrl = await downloadAndHost(cdnUrl, postId);

        // Atualiza TODOS os posts pendentes com esta URL do Instagram
        await admin
          .from("scheduled_posts")
          .update({ video_url: supabaseUrl, error_message: null })
          .eq("video_url", instagramUrl)
          .eq("status", "pending");

        urlsWithRun.delete(instagramUrl);
        summary.resolved++;
        console.log(`[prefetch] ✓ Resolvido: ${instagramUrl.slice(0, 60)} → Supabase`);
      } catch (dlErr) {
        const msg = dlErr instanceof Error ? dlErr.message : String(dlErr);
        console.warn(`[prefetch] ⚠ Download falhou (run ${runId.slice(0, 12)}…): ${msg.slice(0, 100)}`);
        // Limpa marcador para que a Fase 2 reinicie um novo run
        await admin
          .from("scheduled_posts")
          .update({ error_message: null })
          .eq("status", "pending")
          .like("error_message", `${RUN_MARKER_PREFIX}${runId}${RUN_MARKER_SUFFIX}`);
        urlsWithRun.delete(instagramUrl);
        summary.failed++;
      }
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // FASE 2 — Iniciar novos runs Apify para URLs sem run em andamento
  // ═══════════════════════════════════════════════════════════════════════════
  if (!budgetOk(3_000)) {
    const sec = Math.round(elapsed() / 1000);
    console.log(`[prefetch] ■ Resumo (${sec}s):`, summary);
    return NextResponse.json({ ok: true, elapsed_seconds: sec, ...summary });
  }

  // Busca URLs do Instagram ainda sem run em andamento (sem marcador)
  const { data: pendingClone } = await admin
    .from("scheduled_posts")
    .select("id, video_url")
    .eq("status", "pending")
    .like("video_url", "%instagram.com/reel/%")
    .limit(MAX_NEW_RUNS * 3); // busca mais para filtrar duplicatas

  // Deduplica por video_url, excluindo URLs que já têm run
  const newUrls = new Map<string, string>(); // url → postId
  for (const p of pendingClone ?? []) {
    const url = p.video_url as string;
    if (!urlsWithRun.has(url) && !newUrls.has(url)) {
      newUrls.set(url, p.id as string);
    }
    if (newUrls.size >= MAX_NEW_RUNS) break;
  }

  console.log(`[prefetch] Fase 2: ${newUrls.size} URLs novas para iniciar run.`);

  const tokens = resolveApifyTokens();
  if (!tokens.length) {
    console.warn("[prefetch] AVISO: Nenhum token Apify configurado.");
  }

  let tokenIdx = 0;
  for (const [instagramUrl, postId] of newUrls) {
    if (!budgetOk(2_000)) break;

    try {
      const client = new ApifyClient({ token: tokens[tokenIdx % tokens.length] });
      tokenIdx++;

      const run = await client.actor("apify/instagram-scraper").start({
        directUrls: [instagramUrl],
        resultsType: "posts",
        resultsLimit: 1,
        maxRequestsPerCrawl: 5,
        proxyConfiguration: { useApifyProxy: true, apifyProxyGroups: ["RESIDENTIAL"] },
      });

      const marker = makeMarker(run.id);
      await admin
        .from("scheduled_posts")
        .update({ error_message: marker })
        .eq("video_url", instagramUrl)
        .eq("status", "pending");

      summary.started++;
      console.log(
        `[prefetch] 🚀 Run iniciado: ${run.id.slice(0, 12)}… | ${instagramUrl.slice(0, 60)}`
      );
    } catch (startErr) {
      const msg = startErr instanceof Error ? startErr.message : String(startErr);
      console.warn(`[prefetch] ⚠ Falha ao iniciar run para ${instagramUrl.slice(0, 60)}: ${msg.slice(0, 80)}`);
      summary.failed++;
    }
  }

  const sec = Math.round(elapsed() / 1000);
  console.log(`[prefetch] ■ Resumo (${sec}s):`, summary);
  return NextResponse.json({ ok: true, elapsed_seconds: sec, ...summary });
}

