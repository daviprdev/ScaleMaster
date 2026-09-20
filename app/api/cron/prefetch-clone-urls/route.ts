/**
 * /api/cron/prefetch-clone-urls
 *
 * Resolve a mídia das campanhas do "Clonar Perfil": troca o permalink do
 * Instagram (https://www.instagram.com/reel/{shortCode}/) por uma cópia
 * hospedada no Supabase Storage, que é o que a Meta consegue baixar (as URLs
 * assinadas do fbcdn são recusadas pelos servidores de processamento dela).
 *
 * Reescrito em 2026-09-20. O que estava errado antes:
 *
 *  1. O arquivo ia para `temp/clone_{postId}.mp4` e o cleanup do process-loops
 *     apaga `temp/*` com mais de 2h. Toda campanha mais longa que 2h (ou seja,
 *     todas) perdia a mídia no meio: os primeiros posts saíam e o resto morria
 *     com ERROR/EXPIRED, sem chance de recuperação — o permalink original já
 *     tinha sido sobrescrito em video_url.
 *  2. A fila da Fase 2 não tinha ORDER BY: resolvia Reels em ordem arbitrária,
 *     então os posts que já estavam na hora ficavam esperando enquanto Reels
 *     de dias à frente eram baixados.
 *  3. O `.limit(MAX_NEW_RUNS * 3)` era aplicado ANTES da deduplicação por URL.
 *     Com N contas, as 24 linhas lidas podiam ser todas do MESMO Reel — na
 *     prática 1 Reel resolvido por ciclo em vez de 8.
 *  4. O run da Apify era rastreado escrevendo "[APIFY_RUN:{id}]" em
 *     scheduled_posts.error_message, colidindo com a coluna de erro real.
 *  5. Sem teto de tentativas: Reel apagado/privado reiniciava run para sempre,
 *     queimando crédito da Apify indefinidamente.
 *  6. Orçamento de 54s numa função com maxDuration=300.
 *
 * Agora o estado por Reel vive em `clone_media` (1 linha por permalink, com
 * claim atômico), o arquivo vai para `clone/{shortCode}.mp4` — fora de temp/,
 * preservado enquanto algum post pendente o referenciar — e o permalink
 * original fica guardado em `scheduled_posts.clone_source_url`, o que permite
 * re-resolver a mídia em vez de deixar o post quebrado para sempre.
 */

import { NextRequest, NextResponse } from "next/server";
import { ApifyClient } from "apify-client";
import { fetch as undiciFetch } from "undici";
import { resolveApifyTokens } from "@/lib/apify-token-pool";
import { getSupabaseAdmin } from "@/lib/supabase";
import { requireCronAuth } from "@/lib/cron-auth";
import {
  CLONE_PREFIX,
  dedupeQueueByUrl,
  selectPruneTargets,
  shortCodeFromUrl,
  storagePathFor,
} from "@/lib/clone-media";

export const runtime = "nodejs";
export const maxDuration = 300;

const BUDGET_MS = 250_000;
/** Downloads (CDN -> Supabase) por ciclo. Cada um leva 3-25s. */
const MAX_DOWNLOADS_PER_RUN = 6;
/** Runs novos da Apify por ciclo (cada início ~1s, mas cada run é pago). */
const MAX_NEW_RUNS = 8;
/** Teto de bytes baixados por ciclo — evita surpresa de banda na Vercel. */
const MAX_BYTES_PER_RUN = 150 * 1024 * 1024;
/** Tentativas por Reel antes de desistir (Reel apagado, privado, etc.). */
const MAX_ATTEMPTS = 3;
/**
 * Não adianta baixar mídia de post que só sai daqui a dias: o arquivo ficaria
 * ocupando Storage à toa e a fila urgente perderia a vez.
 */
const LOOKAHEAD_MS = 48 * 60 * 60_000;
/** Duração do claim atômico por Reel. */
const CLAIM_MS = 120_000;
/** Arquivo sem nenhum post pendente apontando para ele é podado depois disso. */
const PRUNE_AFTER_MS = 24 * 60 * 60_000;

const STORAGE_BUCKET = "videos-library";

interface CloneMediaRow {
  id: string;
  source_url: string;
  short_code: string | null;
  status: "queued" | "running" | "ready" | "error";
  apify_run_id: string | null;
  hosted_url: string | null;
  storage_path: string | null;
  attempts: number;
  claimed_until: string | null;
}

const MEDIA_COLUMNS =
  "id, source_url, short_code, status, apify_run_id, hosted_url, storage_path, attempts, claimed_until";

/** Localiza o run em algum token do pool (cada run pertence a um token). */
async function findRun(runId: string) {
  for (const token of resolveApifyTokens()) {
    try {
      const client = new ApifyClient({ token });
      const run = await client.run(runId).get();
      if (run) {
        return {
          client,
          status: String(run.status),
          datasetId: (run.defaultDatasetId as string | null) ?? null,
        };
      }
    } catch {
      /* token errado para este run — tenta o próximo */
    }
  }
  return null;
}

/** Baixa do CDN do Instagram e hospeda no Supabase. Devolve URL + tamanho. */
async function downloadAndHost(
  cdnUrl: string,
  shortCode: string
): Promise<{ url: string; path: string; bytes: number }> {
  const admin = getSupabaseAdmin();

  const res = await undiciFetch(cdnUrl, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
      Referer: "https://www.instagram.com/",
    },
    signal: AbortSignal.timeout(25_000),
  });

  if (!res.ok) throw new Error(`CDN respondeu HTTP ${res.status}`);

  const ct = res.headers.get("content-type") ?? "";
  if (ct && !ct.includes("video/") && !ct.includes("octet-stream") && !ct.includes("binary/")) {
    throw new Error(`conteúdo inválido do CDN: ${ct.slice(0, 50)}`);
  }

  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < 50_000) throw new Error(`arquivo muito pequeno: ${buf.length} bytes`);

  const path = storagePathFor(shortCode);
  const { error } = await admin.storage
    .from(STORAGE_BUCKET)
    .upload(path, buf, { contentType: "video/mp4", upsert: true });
  if (error) throw new Error(`upload Supabase: ${error.message}`);

  const { data } = admin.storage.from(STORAGE_BUCKET).getPublicUrl(path);
  return { url: data.publicUrl, path, bytes: buf.length };
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
  const summary = {
    queue_urls: 0,
    reused: 0,
    resolved: 0,
    runs_started: 0,
    still_running: 0,
    gave_up: 0,
    self_healed: 0,
    pruned: 0,
    failed: 0,
  };

  console.log(`[prefetch] > Iniciando. budget=${BUDGET_MS / 1000}s`);

  // ═══════════════════════════════════════════════════════════════════════
  // FASE 0 — Auto-heal: post de clone que falhou volta a apontar para o
  // permalink original, para que a mídia seja resolvida de novo. Sem isso um
  // arquivo perdido deixava o post quebrado para sempre (video_url apontando
  // para um objeto que não existe mais no Storage).
  // ═══════════════════════════════════════════════════════════════════════
  {
    const { data: broken } = await admin
      .from("scheduled_posts")
      .select("id, clone_source_url, video_url")
      .eq("status", "failed")
      .not("clone_source_url", "is", null)
      .not("video_url", "ilike", "%instagram.com%")
      .lt("retry_count", 5)
      .limit(200);

    for (const row of (broken ?? []) as unknown as { id: string; clone_source_url: string }[]) {
      await admin
        .from("scheduled_posts")
        .update({
          status: "pending",
          video_url: row.clone_source_url,
          creation_id: null,
          error_message: null,
        })
        .eq("id", row.id)
        .eq("status", "failed");
      summary.self_healed++;
    }
    if (summary.self_healed) {
      console.log(
        `[prefetch] ${summary.self_healed} post(s) de clone devolvidos à fila para re-resolver a mídia.`
      );
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  // FASE 1 — Fila: posts de clone ainda com o permalink em video_url,
  // ORDENADOS por quem posta primeiro. A deduplicação por Reel acontece
  // DEPOIS da leitura ordenada (com N contas, várias linhas compartilham o
  // mesmo Reel — deduplicar depois de um limit sem ordem era o que travava).
  // ═══════════════════════════════════════════════════════════════════════
  const horizon = new Date(Date.now() + LOOKAHEAD_MS).toISOString();
  const { data: pendingRows, error: queueErr } = await admin
    .from("scheduled_posts")
    .select("id, video_url, scheduled_at")
    .eq("status", "pending")
    .not("clone_source_url", "is", null)
    .ilike("video_url", "%instagram.com%")
    .lte("scheduled_at", horizon)
    .order("scheduled_at", { ascending: true })
    .limit(1000);

  if (queueErr) {
    console.error("[prefetch] Erro ao ler a fila:", queueErr.message);
    return NextResponse.json({ error: queueErr.message }, { status: 500 });
  }

  // URLs distintas, na ordem de urgência (primeiro post agendado). A ordem
  // vem do ORDER BY acima; a deduplicação acontece depois (lib/clone-media).
  const queueUrls = dedupeQueueByUrl(
    (pendingRows ?? []) as unknown as { video_url: string | null }[]
  );
  summary.queue_urls = queueUrls.length;
  console.log(`[prefetch] Fila: ${queueUrls.length} Reel(s) distinto(s) a resolver.`);

  if (queueUrls.length === 0) {
    await prune(admin, summary, budgetOk);
    const sec = Math.round(elapsed() / 1000);
    console.log(`[prefetch] Resumo (${sec}s):`, summary);
    return NextResponse.json({ ok: true, elapsed_seconds: sec, ...summary });
  }

  // Estado atual de cada Reel da fila. Em lotes: com a fila inteira num único
  // `.in()` o Postgres reclama de URL longa demais, e uma leitura PARCIAL aqui
  // seria pior que nenhuma — um Reel com run em andamento pareceria novo e
  // ganharia um segundo run da Apify (pago) por cima do primeiro.
  const mediaByUrl = new Map<string, CloneMediaRow>();
  for (let i = 0; i < queueUrls.length; i += 100) {
    const { data: mediaRows } = await admin
      .from("clone_media")
      .select(MEDIA_COLUMNS)
      .in("source_url", queueUrls.slice(i, i + 100));
    for (const m of (mediaRows ?? []) as unknown as CloneMediaRow[]) mediaByUrl.set(m.source_url, m);
  }

  // Inventário do que já existe no Storage — uma varredura só.
  const existingFiles = new Set<string>();
  try {
    for (let offset = 0; ; offset += 100) {
      const { data: files } = await admin.storage
        .from(STORAGE_BUCKET)
        .list(CLONE_PREFIX, { limit: 100, offset });
      for (const f of files ?? []) existingFiles.add(f.name);
      if (!files || files.length < 100) break;
    }
  } catch (e) {
    console.warn("[prefetch] Não foi possível listar clone/:", String(e));
  }

  /** Aponta todos os posts pendentes daquele Reel para a cópia hospedada. */
  async function applyHostedUrl(sourceUrl: string, hostedUrl: string) {
    await admin
      .from("scheduled_posts")
      .update({ video_url: hostedUrl, error_message: null })
      .eq("video_url", sourceUrl)
      .eq("status", "pending");
  }

  /** Claim atômico por Reel: só uma invocação do cron mexe em cada um. */
  async function claim(row: CloneMediaRow): Promise<boolean> {
    const nowIso = new Date().toISOString();
    const { data } = await admin
      .from("clone_media")
      .update({ claimed_until: new Date(Date.now() + CLAIM_MS).toISOString(), updated_at: nowIso })
      .eq("id", row.id)
      .or(`claimed_until.is.null,claimed_until.lt.${nowIso}`)
      .select("id");
    return !!data?.length;
  }

  async function release(id: string) {
    await admin.from("clone_media").update({ claimed_until: null }).eq("id", id);
  }

  async function giveUp(row: CloneMediaRow, sourceUrl: string, reason: string) {
    await admin
      .from("clone_media")
      .update({
        status: "error",
        last_error: reason.slice(0, 400),
        claimed_until: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", row.id);
    // Post sem mídia nunca vai publicar — deixá-lo "pending" para sempre só
    // engorda a fila e esconde o problema. Falha com o motivo real.
    await admin
      .from("scheduled_posts")
      .update({
        status: "failed",
        error_message:
          `[CLONE] Não foi possível obter o vídeo de ${sourceUrl} após ${MAX_ATTEMPTS} tentativas: ${reason}`.slice(
            0,
            500
          ),
      })
      .eq("video_url", sourceUrl)
      .eq("status", "pending");
    summary.gave_up++;
    console.warn(`[prefetch] Desistindo de ${sourceUrl}: ${reason.slice(0, 120)}`);
  }

  const tokens = resolveApifyTokens();
  let downloads = 0;
  let bytes = 0;
  let newRuns = 0;
  let tokenIdx = 0;

  for (const sourceUrl of queueUrls) {
    if (!budgetOk(30_000)) break;

    const shortCode = shortCodeFromUrl(sourceUrl);
    if (!shortCode) {
      console.warn(`[prefetch] URL sem shortCode reconhecível: ${sourceUrl.slice(0, 80)}`);
      continue;
    }

    let media = mediaByUrl.get(sourceUrl) ?? null;

    // ── Reaproveitamento: arquivo já existe no Storage ───────────────────
    // Vale entre contas da mesma campanha, entre campanhas e entre usuários:
    // o mesmo Reel nunca é baixado duas vezes enquanto o arquivo viver.
    if (existingFiles.has(`${shortCode}.mp4`)) {
      const { data: urlData } = admin.storage
        .from(STORAGE_BUCKET)
        .getPublicUrl(storagePathFor(shortCode));
      await applyHostedUrl(sourceUrl, urlData.publicUrl);
      await admin.from("clone_media").upsert(
        {
          source_url: sourceUrl,
          short_code: shortCode,
          status: "ready",
          hosted_url: urlData.publicUrl,
          storage_path: storagePathFor(shortCode),
          last_error: null,
          claimed_until: null,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "source_url" }
      );
      summary.reused++;
      continue;
    }

    // ── Primeira vez que vemos este Reel ─────────────────────────────────
    // ignoreDuplicates: a linha que já existe NUNCA é sobrescrita — um upsert
    // comum devolveria status='queued' por cima de um 'running', e o run em
    // andamento (pago) seria duplicado no ciclo seguinte.
    if (!media) {
      const { data: inserted } = await admin
        .from("clone_media")
        .upsert(
          {
            source_url: sourceUrl,
            short_code: shortCode,
            status: "queued",
            updated_at: new Date().toISOString(),
          },
          { onConflict: "source_url", ignoreDuplicates: true }
        )
        .select(MEDIA_COLUMNS);

      media = ((inserted ?? [])[0] as unknown as CloneMediaRow | undefined) ?? null;
      if (!media) {
        // Conflito: a linha já existia (outra invocação criou antes). Lê a real.
        const { data: existing } = await admin
          .from("clone_media")
          .select(MEDIA_COLUMNS)
          .eq("source_url", sourceUrl)
          .maybeSingle();
        media = (existing as unknown as CloneMediaRow | null) ?? null;
      }
      if (!media) continue;
    }

    // Já desistimos deste Reel antes — não gasta run de novo.
    if (media.status === "error") continue;

    if (!(await claim(media))) {
      summary.still_running++;
      continue;
    }

    // ── Run em andamento: confere status ─────────────────────────────────
    if (media.status === "running" && media.apify_run_id) {
      const found = await findRun(media.apify_run_id);

      if (!found) {
        await admin
          .from("clone_media")
          .update({
            status: "queued",
            apify_run_id: null,
            claimed_until: null,
            updated_at: new Date().toISOString(),
          })
          .eq("id", media.id);
        continue;
      }

      if (["RUNNING", "READY"].includes(found.status)) {
        await release(media.id);
        summary.still_running++;
        continue;
      }

      if (found.status !== "SUCCEEDED") {
        const attempts = media.attempts + 1;
        if (attempts >= MAX_ATTEMPTS) {
          await giveUp(media, sourceUrl, `run da Apify terminou com ${found.status}`);
        } else {
          await admin
            .from("clone_media")
            .update({
              status: "queued",
              apify_run_id: null,
              attempts,
              last_error: `run ${found.status}`,
              claimed_until: null,
              updated_at: new Date().toISOString(),
            })
            .eq("id", media.id);
        }
        continue;
      }

      // SUCCEEDED -> baixa e hospeda
      if (downloads >= MAX_DOWNLOADS_PER_RUN || bytes >= MAX_BYTES_PER_RUN || !budgetOk(30_000)) {
        await release(media.id);
        continue;
      }

      try {
        const { items } = await found.client.dataset(found.datasetId!).listItems({ limit: 5 });
        const item = (items as Record<string, unknown>[])[0];
        if (!item) throw new Error("dataset vazio (Reel apagado, privado ou indisponível)");

        const cdnUrl =
          (item.videoUrl as string | undefined) ||
          (item.video_url as string | undefined) ||
          (item.videoPlayUrl as string | undefined) ||
          (item.playVideoUrl as string | undefined) ||
          "";
        if (!cdnUrl) throw new Error("item sem URL de vídeo (pode não ser um Reel)");

        downloads++;
        const hosted = await downloadAndHost(cdnUrl, shortCode);
        bytes += hosted.bytes;

        await admin
          .from("clone_media")
          .update({
            status: "ready",
            hosted_url: hosted.url,
            storage_path: hosted.path,
            size_bytes: hosted.bytes,
            last_error: null,
            claimed_until: null,
            updated_at: new Date().toISOString(),
          })
          .eq("id", media.id);

        await applyHostedUrl(sourceUrl, hosted.url);
        existingFiles.add(`${shortCode}.mp4`);
        summary.resolved++;
        console.log(
          `[prefetch] OK ${shortCode}: ${(hosted.bytes / 1_048_576).toFixed(1)}MB hospedados e aplicados aos posts pendentes.`
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        const attempts = media.attempts + 1;
        if (attempts >= MAX_ATTEMPTS) {
          await giveUp(media, sourceUrl, msg);
        } else {
          await admin
            .from("clone_media")
            .update({
              status: "queued",
              apify_run_id: null,
              attempts,
              last_error: msg.slice(0, 400),
              claimed_until: null,
              updated_at: new Date().toISOString(),
            })
            .eq("id", media.id);
          summary.failed++;
          console.warn(
            `[prefetch] ${shortCode} falhou (tentativa ${attempts}/${MAX_ATTEMPTS}): ${msg.slice(0, 120)}`
          );
        }
      }
      continue;
    }

    // ── Reel sem run: inicia um ──────────────────────────────────────────
    if (newRuns >= MAX_NEW_RUNS || !tokens.length) {
      await release(media.id);
      if (!tokens.length) console.warn("[prefetch] AVISO: nenhum token Apify configurado.");
      continue;
    }

    try {
      const client = new ApifyClient({ token: tokens[tokenIdx % tokens.length] });
      tokenIdx++;
      const run = await client.actor("apify/instagram-scraper").start({
        directUrls: [sourceUrl],
        resultsType: "posts",
        resultsLimit: 1,
        maxRequestsPerCrawl: 5,
        proxyConfiguration: { useApifyProxy: true, apifyProxyGroups: ["RESIDENTIAL"] },
      });

      newRuns++;
      await admin
        .from("clone_media")
        .update({
          status: "running",
          apify_run_id: run.id,
          claimed_until: null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", media.id);
      summary.runs_started++;
      console.log(`[prefetch] ${shortCode}: run ${run.id.slice(0, 12)} iniciado.`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const attempts = media.attempts + 1;
      if (attempts >= MAX_ATTEMPTS) {
        await giveUp(media, sourceUrl, `falha ao iniciar run: ${msg}`);
      } else {
        await admin
          .from("clone_media")
          .update({
            attempts,
            last_error: msg.slice(0, 400),
            claimed_until: null,
            updated_at: new Date().toISOString(),
          })
          .eq("id", media.id);
        summary.failed++;
      }
    }
  }

  await prune(admin, summary, budgetOk);

  const sec = Math.round(elapsed() / 1000);
  console.log(`[prefetch] Resumo (${sec}s):`, summary);
  return NextResponse.json({ ok: true, elapsed_seconds: sec, ...summary });
}

/**
 * Poda de clone/: apaga o que NENHUM post pendente referencia e que já passou
 * do período de graça. Diferente do cleanup de temp/ (2h por idade), aqui a
 * idade sozinha nunca basta — o arquivo pode ser a mídia de um post agendado
 * para daqui a três dias. Foi exatamente essa confusão que quebrou o Clone.
 */
async function prune(
  admin: ReturnType<typeof getSupabaseAdmin>,
  summary: { pruned: number },
  budgetOk: (reserve?: number) => boolean
) {
  if (!budgetOk(10_000)) return;

  try {
    const files: { name: string; created_at: string | null }[] = [];
    for (let offset = 0; ; offset += 100) {
      const { data } = await admin.storage
        .from(STORAGE_BUCKET)
        .list(CLONE_PREFIX, { limit: 100, offset });
      for (const f of data ?? []) files.push({ name: f.name, created_at: f.created_at ?? null });
      if (!data || data.length < 100) break;
      if (!budgetOk(10_000)) return;
    }

    const cutoff = Date.now() - PRUNE_AFTER_MS;
    if (!files.some((f) => f.created_at && new Date(f.created_at).getTime() < cutoff)) return;

    // Quais ainda são referenciados por algum post que vai publicar?
    const { data: refs } = await admin
      .from("scheduled_posts")
      .select("video_url")
      .in("status", ["pending", "publishing"])
      .ilike("video_url", `%/${CLONE_PREFIX}/%`)
      .limit(5000);

    const toDelete = selectPruneTargets(
      files,
      ((refs ?? []) as unknown as { video_url: string | null }[]).map((r) => r.video_url),
      cutoff
    );

    if (toDelete.length) {
      for (let i = 0; i < toDelete.length; i += 100) {
        await admin.storage.from(STORAGE_BUCKET).remove(toDelete.slice(i, i + 100));
      }
      // A linha de clone_media some junto: sem arquivo, "ready" seria mentira.
      await admin.from("clone_media").delete().in("storage_path", toDelete);
      summary.pruned = toDelete.length;
      console.log(`[prefetch] ${toDelete.length} arquivo(s) clone/ sem referência removidos.`);
    }
  } catch (e) {
    console.warn("[prefetch] Falha na poda de clone/:", String(e));
  }
}
