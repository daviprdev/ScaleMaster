import { NextRequest, NextResponse } from "next/server";
import * as fs from "fs";
import { getSupabaseAdmin } from "@/lib/supabase";
import {
  createMediaContainerOnly,
  pollContainerStatusOnce,
  publishReadyContainer,
} from "@/lib/meta-publish";
import { refreshMetaToken, isTokenExpiringSoon } from "@/lib/meta-refresh";
import { getProxyForAccount, isProxyNetworkError, recordProxyFailure } from "@/lib/proxy";
import { downloadAndStripMetadata } from "@/lib/ffmpeg-process";
import { isAccountDeadError, markDeadAccounts, type DeadAccountCandidate } from "@/lib/account-health";

export const runtime = "nodejs";
export const maxDuration = 300;

const BATCH_SIZE = 20;
// maxDuration=300 já era liberado pela Vercel, mas o budget próprio ficava em
// só 55s — bem menos que o necessário. O claim atômico por post (linha ~276)
// protege contra processamento duplicado mesmo com invocações do cron (a cada
// 1 min) se sobrepondo, então é seguro usar quase todo o maxDuration.
const RUN_BUDGET_MS = 250_000;

// Reserva de tempo para o strip pipeline por vídeo (download + FFmpeg + upload)
const STRIP_RESERVE_MS = 30_000;

// Cap de tentativas para ERROR/EXPIRED da Meta (vídeo permanentemente rejeitado,
// ex: codec incompatível) — sem isso, o post é recriado como container novo e
// falha de novo a cada execução do cron, pra sempre. Requer scheduled_posts.retry_count
// — ver supabase/scheduled_posts_retry_cap.sql.
const MAX_ERROR_EXPIRED_RETRIES = 5;


// Vídeos com esse padrão foram upados direto pelo browser (sem FFmpeg strip).
// Contêm SEI NAL units tipo 5+6 que a Meta API rejeita → ERROR/EXPIRED.
function needsStrip(url: string): boolean {
  return url.includes("/videos/upload_");
}

interface AccountRow {
  id: string;
  username: string;
  is_active: boolean;
  meta_access_token: string | null;
  ig_business_account_id: string | null;
  token_expires_at: string | null;
  fb_page_id: string | null;
  proxy_url: string | null;
}

interface PostRow {
  id: string;
  user_id: string | null;
  video_id: string | null;
  video_url: string | null;
  caption: string | null;
  scheduled_at: string;
  account_id: string;
  creation_id: string | null;
  post_type: string | null;
  retry_count: number | null;
  instagram_accounts: AccountRow | null;
  videos_library: { public_url: string } | null;
}

// Erros transitórios → retry (status "pending").
// Erros permanentes → "failed".
const TRANSIENT_PATTERNS = [
  "too many actions",
  "an unexpected error has occurred",
  "retry your request later",
  "please retry",
  "service unavailable",
  "internal server error",
  "fetch failed",
  "smartproxy",
  "proxy",
  "timeout",
  "não terminou em",
];

function isCloneUrl(url: string): boolean {
  return url.includes("instagram.com/reel/") || url.includes("instagram.com/p/");
}

// Imagens de story não passam por FFmpeg — detecta pela extensão da URL.
function isImageMedia(url: string): boolean {
  const clean = url.toLowerCase().split("?")[0];
  return clean.endsWith(".jpg") || clean.endsWith(".jpeg") || clean.endsWith(".png");
}

function isTransientError(msg: string): boolean {
  const lower = msg.toLowerCase();
  return TRANSIENT_PATTERNS.some((p) => lower.includes(p));
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export async function GET(req: NextRequest) {
  const runStart = Date.now();

  const cronSecret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization");

  if (!cronSecret) {
    console.warn("[publish-scheduled] AVISO: CRON_SECRET não configurado — endpoint exposto.");
  } else if (auth !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
    return NextResponse.json({ skipped: true, reason: "Supabase não configurado." });
  }

  const admin = getSupabaseAdmin();
  const now = new Date().toISOString();

  console.log(`[publish-scheduled] ▶ Iniciando. now=${now} | batch=${BATCH_SIZE}`);

  // ── Diagnóstico ───────────────────────────────────────────────────────────
  const [{ count: countPending }, { count: countPublishing }] = await Promise.all([
    admin.from("scheduled_posts").select("id", { count: "exact", head: true }).eq("status", "pending"),
    admin.from("scheduled_posts").select("id", { count: "exact", head: true }).eq("status", "publishing"),
  ]);

  const { count: countEligible } = await admin
    .from("scheduled_posts")
    .select("id", { count: "exact", head: true })
    .eq("status", "pending")
    .lte("scheduled_at", now);

  const { count: countFailed } = await admin
    .from("scheduled_posts")
    .select("id", { count: "exact", head: true })
    .eq("status", "failed");

  console.log(
    `[publish-scheduled] Fila: pending=${countPending ?? 0} elegíveis=${countEligible ?? 0} publishing=${countPublishing ?? 0} failed=${countFailed ?? 0}`
  );

  // ── Auto-heal 1: posts presos em "publishing" ─────────────────────────────
  const stuckCutoff = new Date(Date.now() - 5 * 60_000).toISOString();
  const { data: unblocked } = await admin
    .from("scheduled_posts")
    .update({ status: "pending", error_message: null })
    .eq("status", "publishing")
    .lte("scheduled_at", stuckCutoff)
    .select("id");

  if (unblocked?.length) {
    console.log(`[publish-scheduled] ${unblocked.length} post(s) "publishing" → "pending"`);
  }

  // ── Auto-heal 2: posts failed por ERROR/EXPIRED recebem nova tentativa ────
  // Só revive quem ainda não bateu o cap — sem essa checagem, um post que já
  // falhou permanentemente (ver branch pollStatus==="error" abaixo) voltaria a
  // ser reprocessado pra sempre, na prática desfazendo o cap de tentativas.
  const { data: errorExpiredFailedRows } = await admin
    .from("scheduled_posts")
    .select("id, retry_count")
    .eq("status", "failed")
    .ilike("error_message", "%ERROR/EXPIRED%")
    .lte("scheduled_at", now);

  let healedErrorCount = 0;
  for (const row of (errorExpiredFailedRows ?? []) as { id: string; retry_count: number | null }[]) {
    const nextRetryCount = (row.retry_count ?? 0) + 1;
    if (nextRetryCount > MAX_ERROR_EXPIRED_RETRIES) continue;
    await admin
      .from("scheduled_posts")
      .update({ status: "pending", error_message: null, creation_id: null, retry_count: nextRetryCount })
      .eq("id", row.id);
    healedErrorCount++;
  }

  if (healedErrorCount) {
    console.log(`[publish-scheduled] ♻ ${healedErrorCount} post(s) ERROR/EXPIRED → retry.`);
  }

  // ── Busca posts elegíveis ─────────────────────────────────────────────────
  // IMPORTANTE: não buscamos posts com instagram.com URLs — esses são tratados
  // pelo prefetch-clone-urls que resolve as URLs para Supabase antes de publicar.
  const SELECT_FIELDS =
    "id, user_id, video_id, video_url, creation_id, caption, scheduled_at, account_id, post_type, retry_count, " +
    "instagram_accounts(id, username, is_active, meta_access_token, ig_business_account_id, token_expires_at, fb_page_id, proxy_url), " +
    "videos_library(public_url)";

  // Stories furam a fila: usuário espera publicação quase imediata ("Postar agora"),
  // diferente de campanhas em massa (Postar/Clone/Loop) que já são agendadas de
  // propósito ao longo de dias. Busca stories elegíveis primeiro; só preenche o
  // restante do lote com os demais posts se sobrar espaço.
  const { data: storyRows, error: storyErr } = await admin
    .from("scheduled_posts")
    .select(SELECT_FIELDS)
    .eq("status", "pending")
    .eq("post_type", "story")
    .lte("scheduled_at", now)
    .not("video_url", "ilike", "%instagram.com%")
    .order("scheduled_at", { ascending: true })
    .limit(BATCH_SIZE);

  if (storyErr) {
    console.error("[publish-scheduled] Erro ao buscar stories:", storyErr.message);
    return NextResponse.json({ error: storyErr.message }, { status: 500 });
  }

  const remainingSlots = BATCH_SIZE - (storyRows?.length ?? 0);
  let otherRows: unknown[] = [];
  if (remainingSlots > 0) {
    const { data, error: fetchErr } = await admin
      .from("scheduled_posts")
      .select(SELECT_FIELDS)
      .eq("status", "pending")
      .neq("post_type", "story")
      .lte("scheduled_at", now)
      .not("video_url", "ilike", "%instagram.com%")
      .order("scheduled_at", { ascending: true })
      .limit(remainingSlots);

    if (fetchErr) {
      console.error("[publish-scheduled] Erro ao buscar posts:", fetchErr.message);
      return NextResponse.json({ error: fetchErr.message }, { status: 500 });
    }
    otherRows = data ?? [];
  }

  const posts = [...(storyRows ?? []), ...otherRows] as unknown as PostRow[];
  console.log(
    `[publish-scheduled] ${posts.length} post(s) a processar (${storyRows?.length ?? 0} stories priorizados).`
  );

  const summary = {
    total: posts.length,
    published: 0,
    container_created: 0,
    container_reused: 0,
    in_progress: 0,
    failed: 0,
    skipped: 0,
    unblocked: unblocked?.length ?? 0,
    healed_error: healedErrorCount,
    queue_pending: countPending ?? 0,
    queue_eligible: countEligible ?? 0,
    queue_failed_total: countFailed ?? 0,
  };

  let publishAttemptsInThisRun = 0;

  // Detecção passiva de conta caída (2026-07-17): falha permanente com padrão
  // inequívoco de checkpoint/token morto → candidata a health_status='error',
  // marcada após o loop com guarda de cascata (lib/account-health.ts).
  const attemptedAccounts = new Set<string>();
  const deadCandidates: DeadAccountCandidate[] = [];

  for (const post of posts) {
    // ── Budget global ──────────────────────────────────────────────────────
    const elapsed = Date.now() - runStart;
    if (elapsed > RUN_BUDGET_MS) {
      console.log(`[publish-scheduled] ⏱ Budget esgotado (${Math.round(elapsed / 1000)}s).`);
      break;
    }

    const account = post.instagram_accounts;
    const rawVideoUrl = post.video_url ?? post.videos_library?.public_url ?? null;
    const caption = post.caption ?? "";

    // ── Validações rápidas SEM claim ──────────────────────────────────────
    if (!account || !account.is_active) {
      await admin.from("scheduled_posts").update({ status: "failed", error_message: "Conta não encontrada ou inativa." }).eq("id", post.id);
      summary.failed++;
      continue;
    }
    if (!rawVideoUrl) {
      await admin.from("scheduled_posts").update({ status: "failed", error_message: "URL do vídeo não encontrada." }).eq("id", post.id);
      summary.failed++;
      continue;
    }
    if (!account.meta_access_token || !account.ig_business_account_id) {
      await admin.from("scheduled_posts").update({ status: "failed", error_message: "Conta sem credenciais Meta. Reconecte a conta em Contas." }).eq("id", post.id);
      summary.failed++;
      continue;
    }

    // ── Posts com URL do Instagram → prefetch-clone-urls resolve isso ─────
    // Enquanto a URL não for resolvida para Supabase Storage, pulamos aqui.
    // O prefetch-clone-urls atualiza video_url para URL do Supabase antes de
    // chegar neste ponto.
    if (!post.creation_id && isCloneUrl(rawVideoUrl)) {
      console.log(`[publish-scheduled] ⏭ @${account.username} — aguardando prefetch resolver URL clone.`);
      summary.skipped++;
      continue;
    }

    attemptedAccounts.add(account.id);

    const proxy = getProxyForAccount(account.id, account.proxy_url ?? null);

    console.log(
      `[publish-scheduled] Processando post ${post.id} | @${account.username} | ` +
        `creation_id=${post.creation_id ?? "null"} | elapsed=${Math.round((Date.now() - runStart) / 1000)}s`
    );

    // ── CLAIM atômico ──────────────────────────────────────────────────────
    const { data: claimed } = await admin
      .from("scheduled_posts")
      .update({ status: "publishing" })
      .eq("id", post.id)
      .eq("status", "pending")
      .select("id");

    if (!claimed?.length) {
      console.log(`[publish-scheduled] Post ${post.id} já claimado — pulando.`);
      summary.skipped++;
      continue;
    }

    try {
      let tokenToUse = account.meta_access_token;

      if (isTokenExpiringSoon(account.token_expires_at, 7)) {
        try {
          const { token, expiresAt } = await refreshMetaToken(
            account.meta_access_token,
            account.fb_page_id,
            proxy
          );
          await admin
            .from("instagram_accounts")
            .update({ meta_access_token: token, token_expires_at: expiresAt.toISOString() })
            .eq("id", account.id);
          tokenToUse = token;
          console.log(`[publish-scheduled] Token renovado: @${account.username}`);
        } catch (refreshErr) {
          console.warn(
            `[publish-scheduled] Falha ao renovar token @${account.username}: ${refreshErr instanceof Error ? refreshErr.message : refreshErr} — usando atual.`
          );
        }
      }

      // ── FASE 1: Criar container (apenas se ainda não existe) ──────────
      let creationId = post.creation_id;

      if (!creationId) {
        let effectiveVideoUrl = rawVideoUrl;

        // Imagens de story não precisam de FFmpeg (nem strip nem fingerprint).
        if (isImageMedia(rawVideoUrl)) {
          console.log(`[publish-scheduled] 🖼 Imagem de story @${account.username} — pulando FFmpeg.`);
        }

        // ── Strip de metadados para vídeos sem processamento FFmpeg ──────
        // Vídeos upados via browser (/videos/upload_*) contêm SEI NAL units
        // tipo 5+6 (fingerprints Instagram/TikTok) que a Meta API rejeita →
        // status_code=ERROR durante processamento do container.
        // Solução: download + stream copy + strip antes de criar o container.
        if (!isImageMedia(rawVideoUrl) && needsStrip(rawVideoUrl) && Date.now() - runStart < RUN_BUDGET_MS - STRIP_RESERVE_MS) {
          const strippedPath = `temp/strip_${post.id}.mp4`;
          // Tenta reusar versão já stripada (caso de retry)
          const { data: existing } = await admin.storage
            .from("videos-library")
            .list("temp", { search: `strip_${post.id}` });
          const alreadyExists = existing?.some(f => f.name === `strip_${post.id}.mp4`);

          if (alreadyExists) {
            const { data: urlData } = admin.storage.from("videos-library").getPublicUrl(strippedPath);
            effectiveVideoUrl = urlData.publicUrl;
            console.log(`[publish-scheduled] ♻ Strip reutilizado @${account.username}`);
          } else {
            try {
              console.log(`[publish-scheduled] ✂ Stripping @${account.username} — ${rawVideoUrl.slice(-40)}`);
              const result = await downloadAndStripMetadata(rawVideoUrl);
              const buf = fs.readFileSync(result.outputPath);
              result.cleanup();
              const { error: upErr } = await admin.storage
                .from("videos-library")
                .upload(strippedPath, buf, { contentType: "video/mp4", upsert: true });
              if (!upErr) {
                const { data: urlData } = admin.storage.from("videos-library").getPublicUrl(strippedPath);
                effectiveVideoUrl = urlData.publicUrl;
                // Persiste URL limpa para que retentativas não precisem re-strip
                await admin.from("scheduled_posts")
                  .update({ video_url: effectiveVideoUrl })
                  .eq("id", post.id);
                console.log(`[publish-scheduled] ✅ Strip concluído @${account.username} → ${effectiveVideoUrl.slice(-40)}`);
              } else {
                console.warn(`[publish-scheduled] ⚠ Upload strip falhou @${account.username}: ${upErr.message} — usando URL original.`);
              }
            } catch (stripErr) {
              console.warn(`[publish-scheduled] ⚠ Strip falhou @${account.username}: ${stripErr instanceof Error ? stripErr.message : stripErr} — usando URL original.`);
            }
          }
        } else if (!isImageMedia(rawVideoUrl) && needsStrip(rawVideoUrl)) {
          // Budget insuficiente para strip — prossegue com URL original.
          // Melhor tentar do que pular: se Meta aceitar, publica; se rejeitar (SEI),
          // retenta com strip na próxima execução (creation_id=null após ERROR).
          console.warn(`[publish-scheduled] ⏱ Budget insuficiente para strip @${account.username} — prosseguindo com URL original.`);
        }

        // SEM fingerprint automático: re-encode (libx264 CRF 22 + maxrate 4M +
        // noise + pitch shift) degradava a qualidade → Instagram re-transcodifica
        // de fonte ruim → retenção baixa → alcance suprimido (0–200 views vs 25k
        // do Loop, que sempre postou a URL original). Mesma lição de 2026-06-18.
        // A URL original do Supabase vai direto para a Meta, igual ao process-loops.

        // Guarda de segurança: não deve acontecer com a nova arquitetura
        if (isCloneUrl(effectiveVideoUrl)) {
          console.warn(`[publish-scheduled] ⚠ @${account.username} — clone URL não resolvida no claim, adiando.`);
          await admin.from("scheduled_posts").update({ status: "pending" }).eq("id", post.id);
          summary.skipped++;
          continue;
        }

        console.log(
          `[publish-scheduled] Criando container @${account.username} | proxy=${proxy ? "sim" : "não"} | ${effectiveVideoUrl.slice(0, 70)}…`
        );
        const mediaType = post.post_type === "story" ? "STORIES" : "REELS";
        creationId = await createMediaContainerOnly(
          account.ig_business_account_id,
          effectiveVideoUrl,
          caption,
          tokenToUse,
          proxy,
          mediaType
        );
        await admin
          .from("scheduled_posts")
          .update({ creation_id: creationId })
          .eq("id", post.id);
        summary.container_created++;
        console.log(`[publish-scheduled] ✓ Container: ${creationId} (@${account.username})`);
      } else {
        summary.container_reused++;
        console.log(`[publish-scheduled] ↩ Reuse ${creationId} (@${account.username})`);
      }

      // ── FASE 2: Poll status ───────────────────────────────────────────
      const pollStatus = await pollContainerStatusOnce(creationId, tokenToUse, proxy);

      if (pollStatus === "in_progress") {
        await admin
          .from("scheduled_posts")
          .update({ status: "pending", error_message: null })
          .eq("id", post.id);
        summary.in_progress++;
        console.log(`[publish-scheduled] ⏳ @${account.username}: IN_PROGRESS.`);
        continue;
      }

      if (pollStatus === "error") {
        // Este é o caminho ativo real do ERROR/EXPIRED da Meta (o "Auto-heal 2"
        // acima cobre um cenário defensivo diferente) — sem cap aqui, um vídeo
        // permanentemente rejeitado (ex: codec incompatível) fica sendo recriado
        // como container novo e falhando de novo a cada minuto, pra sempre.
        const nextRetryCount = (post.retry_count ?? 0) + 1;
        if (nextRetryCount > MAX_ERROR_EXPIRED_RETRIES) {
          await admin
            .from("scheduled_posts")
            .update({
              status: "failed",
              error_message: `[FALHA PERMANENTE] Meta rejeitou o vídeo (ERROR/EXPIRED) após ${MAX_ERROR_EXPIRED_RETRIES} tentativas — não será mais reprocessado.`,
              creation_id: null,
              retry_count: nextRetryCount,
            })
            .eq("id", post.id);
          summary.failed++;
          console.warn(`[publish-scheduled] ⛔ @${account.username}: ERROR/EXPIRED atingiu o cap de ${MAX_ERROR_EXPIRED_RETRIES} tentativas — falha permanente.`);
          continue;
        }

        await admin
          .from("scheduled_posts")
          .update({
            status: "pending",
            error_message: `[RETRY ${nextRetryCount}/${MAX_ERROR_EXPIRED_RETRIES}] Container Meta ERROR/EXPIRED — recriando na próxima execução.`,
            creation_id: null,
            retry_count: nextRetryCount,
            // Empurra +3min: sem isso, este post continua sendo o primeiro da
            // fila (ordenada por scheduled_at) e trava todo mundo atrás dele
            // (mesmo padrão de starvation documentado em 2026-07-05).
            scheduled_at: new Date(Date.now() + 3 * 60_000).toISOString(),
          })
          .eq("id", post.id);
        summary.skipped++;
        console.warn(`[publish-scheduled] ⚠ @${account.username}: ERROR/EXPIRED → retry ${nextRetryCount}/${MAX_ERROR_EXPIRED_RETRIES}.`);
        continue;
      }

      // FINISHED → publicar
      if (publishAttemptsInThisRun > 0) {
        await sleep(2_000); // era 8s — cada conta tem proxy/token próprio, anti-burst leve suficiente
      }
      publishAttemptsInThisRun++;

      console.log(`[publish-scheduled] Publicando ${creationId} (@${account.username})…`);
      const mediaId = await publishReadyContainer(
        account.ig_business_account_id,
        creationId,
        tokenToUse,
        proxy
      );

      await admin
        .from("scheduled_posts")
        .update({
          status: "published",
          published_at: new Date().toISOString(),
          media_id: mediaId ?? null,
          error_message: null,
        })
        .eq("id", post.id);

      summary.published++;
      console.log(
        `[publish-scheduled] ✓ @${account.username} → media_id: ${mediaId} | ${Math.round((Date.now() - runStart) / 1000)}s`
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);

      if (isTransientError(msg)) {
        console.warn(`[publish-scheduled] ⏸ @${account.username} (${post.id}): transitório → retry. ${msg.slice(0, 100)}`);
        // Rate-limit da Meta: empurra scheduled_at +2min com jitter 0–60s. Sem isso,
        // o lote inteiro rate-limitado era re-tentado de uma vez a cada minuto,
        // tomando rate-limit de novo em cascata. Erros de proxy/timeout mantêm o
        // horário original (retry no próximo ciclo resolve blip de rede).
        const isRateLimit = /too many actions|retry your request later|please retry/i.test(msg);
        const retryUpdate: Record<string, string> = {
          status: "pending",
          error_message: `[RETRY] ${msg.slice(0, 300)}`,
        };
        if (isRateLimit) {
          retryUpdate.scheduled_at = new Date(
            Date.now() + 120_000 + Math.floor(Math.random() * 60_000)
          ).toISOString();
        }
        await admin
          .from("scheduled_posts")
          .update(retryUpdate)
          .eq("id", post.id);
        // Falha de proxy → registra na conta para o ProxyOutageBanner do dashboard.
        if (account.proxy_url && isProxyNetworkError(msg)) {
          await recordProxyFailure(admin, account.id, "publish-scheduled", msg);
        }
        summary.skipped++;
      } else {
        console.error(`[publish-scheduled] ✗ @${account.username} (${post.id}):`, msg);
        await admin
          .from("scheduled_posts")
          .update({ status: "failed", error_message: msg, creation_id: null })
          .eq("id", post.id);
        summary.failed++;
        // Conta caída de verdade (checkpoint/token morto) → candidata a vermelho.
        if (post.user_id && isAccountDeadError(msg)) {
          deadCandidates.push({
            accountId: account.id,
            username: account.username,
            userId: post.user_id,
            reason: msg,
          });
        }
      }
    }
  }

  // Marcação passiva de saúde — com guarda de cascata (outage não marca ninguém).
  await markDeadAccounts(admin, "publish-scheduled", deadCandidates, attemptedAccounts.size);

  const totalElapsed = Math.round((Date.now() - runStart) / 1000);
  console.log(`[publish-scheduled] ■ Resumo (${totalElapsed}s):`, summary);
  return NextResponse.json({ ok: true, elapsed_seconds: totalElapsed, ...summary });
}
