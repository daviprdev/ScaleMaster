import { NextRequest, NextResponse } from "next/server";
import { fetch as undiciFetch } from "undici";
import { getSupabaseAdmin } from "@/lib/supabase";
import {
  createMediaContainerOnly,
  pollContainerStatusOnce,
  publishReadyContainer,
} from "@/lib/meta-publish";
import { refreshMetaToken, isTokenExpiringSoon } from "@/lib/meta-refresh";
import { getProxyForAccount } from "@/lib/proxy";
import { applyVideoEffects } from "@/lib/video-effects";
import { withApifyTokenPool } from "@/lib/apify-token-pool";

export const runtime = "nodejs";
export const maxDuration = 300;

// Orçamento de tempo — Hobby plan: 60s real.
// Com a nova arquitetura (claim APÓS Apify), o pior caso é:
//   Apify ~30s + download ~10s + upload ~5s + claim + container + poll ~5s = ~50s
// Dentro do limite de 60s.
const BATCH_SIZE = 10;
const RUN_BUDGET_MS = 55_000;

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
  video_id: string | null;
  video_url: string | null;
  caption: string | null;
  scheduled_at: string;
  account_id: string;
  creation_id: string | null;
  instagram_accounts: AccountRow | null;
  videos_library: { public_url: string } | null;
}

// Erros transitórios da Meta ou de rede → manter creation_id, tentar de novo.
// Erros de token/credenciais → marcar como "failed" permanente.
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
  "apify",
  "não terminou em",
  "download cdn",
  "upload supabase",
];

// ── Clone: detecta URL de página do Instagram ────────────────────────────────

function isCloneUrl(url: string): boolean {
  return url.includes("instagram.com/reel/") || url.includes("instagram.com/p/");
}

async function fetchFreshReelUrl(instagramUrl: string): Promise<string> {
  return withApifyTokenPool(async (client) => {
    const run = await client.actor("apify/instagram-scraper").start({
      directUrls: [instagramUrl],
      resultsType: "posts",
      resultsLimit: 1,
      maxRequestsPerCrawl: 5,
      proxyConfiguration: { useApifyProxy: true, apifyProxyGroups: ["RESIDENTIAL"] },
    });

    // Poll até 10 × 3s = 30s (reduzido de 15×3=45s para caber no budget Hobby)
    for (let i = 0; i < 10; i++) {
      await new Promise<void>(r => setTimeout(r, 3_000));
      const status = await client.run(run.id).get();
      if (!status) break;
      if (["FAILED", "TIMED-OUT", "ABORTED"].includes(status.status as string)) {
        throw new Error(`Apify run ${status.status} para ${instagramUrl}`);
      }
      if (status.status === "SUCCEEDED") {
        const { items } = await client.dataset(run.defaultDatasetId as string).listItems();
        const item = (items as Record<string, unknown>[])[0];
        if (!item) throw new Error("Reel não retornado pelo Apify.");
        const videoUrl =
          (item.videoUrl as string | undefined) ||
          (item.video_url as string | undefined) ||
          (item.videoPlayUrl as string | undefined) ||
          (item.playVideoUrl as string | undefined) || "";
        if (!videoUrl) throw new Error("Reel sem URL de vídeo — conteúdo indisponível ou post de foto.");
        return videoUrl;
      }
    }
    throw new Error(`Apify não terminou em 30s para ${instagramUrl}`);
  });
}

function isTransientError(msg: string): boolean {
  const lower = msg.toLowerCase();
  return TRANSIENT_PATTERNS.some(p => lower.includes(p));
}

// ── Clone: baixa vídeo do CDN e hospeda no Supabase Storage ──────────────────
// A Meta não consegue baixar URLs signed do CDN do Instagram (fbcdn.net).
// Hospedamos no Storage público antes de criar o container Meta.
async function downloadAndHostForMeta(
  cdnUrl: string,
  postId: string,
  proxy: ReturnType<typeof getProxyForAccount>,
): Promise<string> {
  const admin = getSupabaseAdmin();

  const fetchInit: Parameters<typeof undiciFetch>[1] = {
    headers: {
      "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
    },
    signal: AbortSignal.timeout(30_000),
    ...((proxy) ? { dispatcher: proxy } : {}),
  };

  const res = await undiciFetch(cdnUrl, fetchInit);
  if (!res.ok) throw new Error(`download cdn falhou: HTTP ${res.status} para ${cdnUrl.slice(0, 80)}`);

  // Valida Content-Type para não subir HTML de erro como se fosse vídeo
  const contentType = res.headers.get("content-type") ?? "";
  if (contentType && !contentType.includes("video/") && !contentType.includes("octet-stream") && !contentType.includes("binary/")) {
    throw new Error(`download cdn retornou conteúdo não-vídeo (${contentType.slice(0, 60)}) — CDN pode ter retornado página de erro`);
  }

  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < 50_000) throw new Error(`download cdn retornou arquivo muito pequeno (${buf.length} bytes) — possível erro de auth na CDN`);

  const storagePath = `temp/clone_${postId}.mp4`;
  const { error } = await admin.storage
    .from("videos-library")
    .upload(storagePath, buf, { contentType: "video/mp4", upsert: true });

  if (error) throw new Error(`upload supabase falhou: ${error.message}`);

  const { data } = admin.storage.from("videos-library").getPublicUrl(storagePath);
  console.log(`[publish-scheduled] ✓ Clone hospedado em Supabase: ${(buf.length / 1_048_576).toFixed(1)}MB | ${data.publicUrl.slice(0, 80)}…`);
  return data.publicUrl;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export async function GET(req: NextRequest) {
  const runStart = Date.now();

  const cronSecret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization");

  if (cronSecret && auth !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!cronSecret) {
    console.warn("[publish-scheduled] AVISO: CRON_SECRET não configurado — rota acessível sem autenticação.");
  }

  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
    return NextResponse.json({ skipped: true, reason: "Supabase não configurado." });
  }

  const admin = getSupabaseAdmin();
  const now = new Date().toISOString();

  console.log(`[publish-scheduled] ▶ Iniciando execução. now=${now} | batch_size=${BATCH_SIZE}`);

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

  const countFuture = Math.max(0, (countPending ?? 0) - (countEligible ?? 0));

  console.log(
    `[publish-scheduled] Diagnóstico da fila:\n` +
    `  ├─ pending total:     ${countPending ?? 0}\n` +
    `  ├─ elegíveis agora:   ${countEligible ?? 0}\n` +
    `  ├─ data futura:       ${countFuture}\n` +
    `  ├─ em publicação:     ${countPublishing ?? 0}\n` +
    `  └─ falhas acumuladas: ${countFailed ?? 0}`
  );

  // ── Auto-heal 1: posts presos em "publishing" ─────────────────────────────
  // Com a nova arquitetura (claim após Apify), posts não devem ficar presos.
  // Mas mantemos como segurança para posts de runs anteriores.
  const stuckCutoff = new Date(Date.now() - 5 * 60_000).toISOString();
  const { data: unblocked } = await admin
    .from("scheduled_posts")
    .update({ status: "pending", error_message: null })
    .eq("status", "publishing")
    .lte("scheduled_at", stuckCutoff)
    .select("id");

  if (unblocked?.length) {
    console.log(`[publish-scheduled] ${unblocked.length} post(s) desbloqueados "publishing" → "pending"`);
  }

  // ── Auto-heal 2: posts failed por ERROR/EXPIRED recebem nova tentativa ────
  // Containers Meta com ERROR/EXPIRED são transitórios (CDN expira, Meta instável).
  // Resetamos para pending com creation_id limpo para recriar o container.
  const { data: healedError } = await admin
    .from("scheduled_posts")
    .update({ status: "pending", error_message: null, creation_id: null })
    .eq("status", "failed")
    .ilike("error_message", "%ERROR/EXPIRED%")
    .lte("scheduled_at", now)
    .select("id");

  if (healedError?.length) {
    console.log(`[publish-scheduled] ♻ ${healedError.length} post(s) ERROR/EXPIRED resetados para retry.`);
  }

  // ── Busca posts elegíveis ─────────────────────────────────────────────────
  const { data: rows, error: fetchErr } = await admin
    .from("scheduled_posts")
    .select(
      "id, video_id, video_url, creation_id, caption, scheduled_at, account_id, " +
      "instagram_accounts(id, username, is_active, meta_access_token, ig_business_account_id, token_expires_at, fb_page_id, proxy_url), " +
      "videos_library(public_url)"
    )
    .eq("status", "pending")
    .lte("scheduled_at", now)
    .order("scheduled_at", { ascending: true })
    .limit(BATCH_SIZE);

  if (fetchErr) {
    console.error("[publish-scheduled] Erro ao buscar posts elegíveis:", fetchErr.message);
    return NextResponse.json({ error: fetchErr.message }, { status: 500 });
  }

  const posts = (rows ?? []) as unknown as PostRow[];
  console.log(`[publish-scheduled] ${posts.length} post(s) a processar nesta execução.`);

  const summary = {
    total: posts.length,
    published: 0,
    container_created: 0,
    container_reused: 0,
    in_progress: 0,
    failed: 0,
    skipped: 0,
    unblocked: unblocked?.length ?? 0,
    healed_error: healedError?.length ?? 0,
    queue_pending: countPending ?? 0,
    queue_eligible: countEligible ?? 0,
    queue_future: countFuture,
    queue_failed_total: countFailed ?? 0,
  };

  let publishAttemptsInThisRun = 0;
  // 1 scrape Apify por run — cada scrape leva ~30s, dentro do budget Hobby 60s.
  // Cache em memória: instagram URL → Supabase URL (reutilizado pelo mesmo batch).
  let cloneFetchCount = 0;
  const cloneUrlCache = new Map<string, string>();

  for (const post of posts) {
    // ── Budget global da execução ─────────────────────────────────────────
    const elapsed = Date.now() - runStart;
    if (elapsed > RUN_BUDGET_MS) {
      console.log(`[publish-scheduled] ⏱ Budget esgotado (${Math.round(elapsed / 1000)}s). Próximos posts no próximo ciclo.`);
      break;
    }

    // ── Extrai dados ANTES do claim para poder falhar sem travar o post ───
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

    const proxy = getProxyForAccount(account.id, account.proxy_url ?? null);

    console.log(
      `[publish-scheduled] Processando post ${post.id} | ` +
      `@${account.username} | ` +
      `creation_id=${post.creation_id ?? "null (novo)"} | ` +
      `elapsed=${Math.round((Date.now() - runStart) / 1000)}s`
    );

    // ── PRÉ-PROCESSAMENTO: resolve clone URL ANTES do claim ───────────────
    // Crítico: não claimar o post durante o Apify (pode levar 30s+).
    // Se a função Vercel for morta durante o Apify, o post fica em "pending"
    // (não em "publishing"), evitando o ciclo de travamento 5 minutos.
    let videoUrl = rawVideoUrl;

    if (!post.creation_id && isCloneUrl(rawVideoUrl)) {
      const originalInstagramUrl = rawVideoUrl;

      if (cloneUrlCache.has(originalInstagramUrl)) {
        // Cache hit: mesmo reel já foi resolvido neste batch
        videoUrl = cloneUrlCache.get(originalInstagramUrl)!;
        console.log(`[publish-scheduled] ✓ @${account.username} — clone URL do cache em memória.`);
      } else if (cloneFetchCount >= 1) {
        // Só 1 scrape Apify por run (protege o budget de 55s)
        console.log(`[publish-scheduled] ⏭ @${account.username} — scrape Apify já usado neste ciclo, adiado.`);
        summary.skipped++;
        continue;
      } else if ((Date.now() - runStart) > RUN_BUDGET_MS - 20_000) {
        // Menos de 20s no budget — não há tempo para Apify (30s mín)
        console.log(`[publish-scheduled] ⏭ @${account.username} — budget insuficiente para scrape, adiado.`);
        summary.skipped++;
        continue;
      } else {
        // Scrape Apify — SEM CLAIM (post permanece em "pending" durante o scrape)
        cloneFetchCount++;
        console.log(`[publish-scheduled] 🔄 @${account.username} — buscando CDN fresco via Apify: ${originalInstagramUrl}`);
        try {
          const cdnUrl = await fetchFreshReelUrl(originalInstagramUrl);
          console.log(`[publish-scheduled] ✓ CDN obtido: ${cdnUrl.slice(0, 80)}…`);

          videoUrl = await downloadAndHostForMeta(cdnUrl, post.id, proxy);
          cloneUrlCache.set(originalInstagramUrl, videoUrl);

          // Propaga URL Supabase para TODOS os posts com este reel (todas as contas)
          await admin
            .from("scheduled_posts")
            .update({ video_url: videoUrl })
            .eq("video_url", originalInstagramUrl)
            .in("status", ["pending"]);
          console.log(`[publish-scheduled] ✓ URL Supabase propagada para todos os posts com o mesmo reel.`);
        } catch (cloneErr) {
          const msg = cloneErr instanceof Error ? cloneErr.message : String(cloneErr);
          console.warn(`[publish-scheduled] ⚠ @${account.username} — resolução clone falhou: ${msg.slice(0, 120)}`);
          if (!isTransientError(msg)) {
            // Erro permanente (reel privado, deletado, sem vídeo)
            await admin.from("scheduled_posts").update({ status: "failed", error_message: msg }).eq("id", post.id);
            summary.failed++;
          } else {
            summary.skipped++;
          }
          continue;
        }
      }
    }

    // ── CLAIM atômico: agora temos a URL resolvida, podemos claimar ────────
    const { data: claimed } = await admin
      .from("scheduled_posts")
      .update({ status: "publishing" })
      .eq("id", post.id)
      .eq("status", "pending")
      .select("id");

    if (!claimed?.length) {
      console.log(`[publish-scheduled] Post ${post.id} já claimado por outra instância — pulando.`);
      summary.skipped++;
      continue;
    }

    try {
      let tokenToUse = account.meta_access_token;

      if (isTokenExpiringSoon(account.token_expires_at, 7)) {
        try {
          const { token, expiresAt } = await refreshMetaToken(account.meta_access_token, account.fb_page_id, proxy);
          await admin
            .from("instagram_accounts")
            .update({ meta_access_token: token, token_expires_at: expiresAt.toISOString() })
            .eq("id", account.id);
          tokenToUse = token;
          console.log(`[publish-scheduled] Token renovado para @${account.username}`);
        } catch (refreshErr) {
          const refreshMsg = refreshErr instanceof Error ? refreshErr.message : String(refreshErr);
          console.warn(`[publish-scheduled] Falha ao renovar token de @${account.username}: ${refreshMsg} — usando token atual.`);
        }
      }

      // ── FASE 1: Criar container (apenas se ainda não existe) ──────────────
      let creationId = post.creation_id;

      if (!creationId) {
        // Aplica efeitos anti-fingerprint (no-op se todos desativados)
        let effectiveVideoUrl = videoUrl;
        try {
          effectiveVideoUrl = await applyVideoEffects(videoUrl, {
            mirror: false, invert: false, zoom: false,
            blur: false, noise: false, antiAi: false,
            accountId: account.id,
          });
        } catch (fxErr) {
          console.warn(
            `[publish-scheduled] ⚠ Efeitos falharam para @${account.username}: ` +
            `${fxErr instanceof Error ? fxErr.message : String(fxErr)} — usando URL original.`
          );
        }

        // Guarda de segurança: se ainda for URL do Instagram, adia (não deve acontecer)
        if (isCloneUrl(effectiveVideoUrl)) {
          console.warn(`[publish-scheduled] ⚠ @${account.username} — clone URL ainda não resolvida, adiando.`);
          await admin.from("scheduled_posts").update({ status: "pending" }).eq("id", post.id);
          summary.skipped++;
          continue;
        }

        console.log(`[publish-scheduled] Criando container Meta para @${account.username} | proxy=${proxy ? "sim" : "não"} | url=${effectiveVideoUrl.slice(0, 80)}…`);
        creationId = await createMediaContainerOnly(
          account.ig_business_account_id,
          effectiveVideoUrl,
          caption,
          tokenToUse,
          proxy
        );
        // Persiste imediatamente — falhas subsequentes não recriam o container
        await admin
          .from("scheduled_posts")
          .update({ creation_id: creationId })
          .eq("id", post.id);
        summary.container_created++;
        console.log(`[publish-scheduled] ✓ Container criado: ${creationId} (@${account.username})`);
      } else {
        summary.container_reused++;
        console.log(`[publish-scheduled] ↩ Reutilizando container ${creationId} para @${account.username}.`);
      }

      // ── FASE 2: Pollar status UMA vez ─────────────────────────────────────
      const pollStatus = await pollContainerStatusOnce(creationId, tokenToUse, proxy);

      if (pollStatus === "in_progress") {
        await admin
          .from("scheduled_posts")
          .update({ status: "pending", error_message: null })
          .eq("id", post.id);
        summary.in_progress++;
        console.log(`[publish-scheduled] ⏳ @${account.username}: vídeo em processamento (IN_PROGRESS).`);
        continue;
      }

      if (pollStatus === "error") {
        // Container ERROR/EXPIRED é transitório (CDN do Supabase pode ter expirado,
        // Meta instável, vídeo ainda sendo processado). Limpa creation_id e retenta
        // na próxima execução com um container novo.
        // NÃO marca como "failed" permanente — evita posts perdidos para sempre.
        await admin
          .from("scheduled_posts")
          .update({
            status: "pending",
            error_message: "[RETRY] Container Meta ERROR/EXPIRED — recriando container na próxima execução.",
            creation_id: null,
          })
          .eq("id", post.id);
        summary.skipped++;
        console.warn(`[publish-scheduled] ⚠ @${account.username}: container ERROR/EXPIRED — será reprocessado.`);
        continue;
      }

      // FINISHED — publicar!
      if (publishAttemptsInThisRun > 0) {
        await sleep(8_000); // anti-burst: delay entre publishes consecutivos
      }
      publishAttemptsInThisRun++;

      console.log(`[publish-scheduled] Publicando container ${creationId} para @${account.username}...`);
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
      console.log(`[publish-scheduled] ✓ @${account.username} → media_id: ${mediaId} | elapsed: ${Math.round((Date.now() - runStart) / 1000)}s`);

    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);

      if (isTransientError(msg)) {
        const retryMsg = `[RETRY] ${msg.slice(0, 300)}`;
        console.warn(`[publish-scheduled] ⏸ @${account.username} (post ${post.id}): erro transitório — retry no próximo ciclo. Motivo: ${msg.slice(0, 120)}`);
        await admin
          .from("scheduled_posts")
          .update({ status: "pending", error_message: retryMsg })
          .eq("id", post.id);
        summary.skipped++;
      } else {
        console.error(`[publish-scheduled] ✗ @${account.username} (post ${post.id}):`, msg);
        await admin
          .from("scheduled_posts")
          .update({ status: "failed", error_message: msg, creation_id: null })
          .eq("id", post.id);
        summary.failed++;
      }
    }
  }

  const totalElapsed = Math.round((Date.now() - runStart) / 1000);
  console.log(`[publish-scheduled] ■ Resumo (${totalElapsed}s):`, summary);
  return NextResponse.json({ ok: true, elapsed_seconds: totalElapsed, ...summary });
}
