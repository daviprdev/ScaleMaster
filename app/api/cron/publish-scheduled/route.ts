import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import {
  createMediaContainerOnly,
  pollContainerStatusOnce,
  publishReadyContainer,
} from "@/lib/meta-publish";
import { refreshMetaToken, isTokenExpiringSoon } from "@/lib/meta-refresh";
import {
  selectProxyForPublish,
  closeProxyAgent,
  type SelectedProxy,
} from "@/lib/publish-proxy-selector";
import {
  normalizeProcessingMode,
  resolveMediaUrlForMode,
  isImageMedia,
  type VideoProcessingMode,
} from "@/lib/video-processing";
import { isAccountDeadError, markDeadAccounts, type DeadAccountCandidate } from "@/lib/account-health";
import { requireCronAuth } from "@/lib/cron-auth";

export const runtime = "nodejs";
export const maxDuration = 300;

const BATCH_SIZE = 20;
// maxDuration=300 já era liberado pela Vercel, mas o budget próprio ficava em
// só 55s — bem menos que o necessário. O claim atômico por post (linha ~276)
// protege contra processamento duplicado mesmo com invocações do cron (a cada
// 1 min) se sobrepondo, então é seguro usar quase todo o maxDuration.
const RUN_BUDGET_MS = 250_000;

// Cap de tentativas para ERROR/EXPIRED da Meta (vídeo permanentemente rejeitado,
// ex: codec incompatível) — sem isso, o post é recriado como container novo e
// falha de novo a cada execução do cron, pra sempre. Requer scheduled_posts.retry_count
// — ver supabase/scheduled_posts_retry_cap.sql.
const MAX_ERROR_EXPIRED_RETRIES = 5;


interface AccountRow {
  id: string;
  username: string;
  is_active: boolean;
  meta_access_token: string | null;
  ig_business_account_id: string | null;
  token_expires_at: string | null;
  fb_page_id: string | null;
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
  video_processing_mode: string | null;
  share_to_feed: boolean | null;
  campaign_id: string | null;
  use_proxy_pool: boolean | null;
  proxy_pool_id_used: string | null;
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

function isTransientError(msg: string): boolean {
  const lower = msg.toLowerCase();
  return TRANSIENT_PATTERNS.some((p) => lower.includes(p));
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export async function GET(req: NextRequest) {
  const runStart = Date.now();

  const cronAuth = requireCronAuth(req);
  if (!cronAuth.ok) return cronAuth.response;

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
  // P1: Usa publishing_started_at (início real do processamento) em vez de
  // scheduled_at (horário agendado). Um post agendado há 30 min mas iniciado
  // há 10 segundos não deve ser recuperado. Só recupera quem realmente começou
  // a processar há mais de 5 minutos sem finalizar.
  const stuckCutoff = new Date(Date.now() - 5 * 60_000).toISOString();
  const { data: unblocked } = await admin
    .from("scheduled_posts")
    .update({ status: "pending", error_message: null, publishing_started_at: null })
    .eq("status", "publishing")
    .lte("publishing_started_at", stuckCutoff)
    .select("id");

  if (unblocked?.length) {
    console.log(`[publish-scheduled] ${unblocked.length} post(s) "publishing" → "pending" (lease expirado)`);
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
  // P1 CORREÇÃO: Filtrar campanhas ativas antes de claimar posts.
  // O código anterior buscava todos os posts "pending" sem verificar se a
  // campanha associada estava em estado "active". Isso permitia que workers
  // consumissem posts de campanhas ainda em "preparing" (incompletas), causando
  // publicação parcial e falhas silenciosas.
  //
  // Solução: buscar posts SEM join com distribute_campaigns (a FK pode não estar
  // no schema cache do PostgREST, causando erro 500). O filtro de campanha ativa
  // é aplicado em memória após a consulta, usando uma segunda query cirúrgica
  // apenas para os campaign_ids presentes no batch.
  // Preservar posts de Loop/Clonar/Postar manual que não têm campanha.
  const SELECT_FIELDS =
    "id, user_id, video_id, video_url, creation_id, caption, scheduled_at, account_id, post_type, retry_count, video_processing_mode, share_to_feed, campaign_id, use_proxy_pool, proxy_pool_id_used, " +
    "instagram_accounts(id, username, is_active, meta_access_token, ig_business_account_id, token_expires_at, fb_page_id), " +
    "videos_library(public_url)";

  // Campanhas pausadas pelo usuário (aba Postar) mantêm os posts 'pending' —
  // a fila delas fica congelada. Elas precisam sair da busca no próprio banco:
  // o filtro em memória mais abaixo também as barraria, mas aí os posts
  // vencidos de uma campanha pausada ocupariam o lote inteiro a cada execução
  // e travariam a fila de todas as outras. Fail-closed: sem saber quais estão
  // pausadas, não publica nada nesta execução (o próximo minuto tenta de novo).
  const { data: pausedRows, error: pausedErr } = await admin
    .from("distribute_campaigns")
    .select("id")
    .eq("status", "paused");

  if (pausedErr) {
    console.error("[publish-scheduled] Erro ao buscar campanhas pausadas:", pausedErr.message);
    return NextResponse.json({ error: pausedErr.message }, { status: 500 });
  }

  const pausedCampaignIds = ((pausedRows ?? []) as { id: string }[]).map((r) => r.id);
  // `campaign_id NOT IN (...)` sozinho descartaria também os posts sem campanha
  // (NULL NOT IN → NULL), por isso o OR explícito com campaign_id IS NULL.
  const pausedFilter = pausedCampaignIds.length > 0
    ? `campaign_id.is.null,campaign_id.not.in.(${pausedCampaignIds.join(",")})`
    : null;

  // Stories furam a fila: usuário espera publicação quase imediata ("Postar agora"),
  // diferente de campanhas em massa (Postar/Clone/Loop) que já são agendadas de
  // propósito ao longo de dias. Busca stories elegíveis primeiro; só preenche o
  // restante do lote com os demais posts se sobrar espaço.
  // P1: Filtrar por campanha ativa OU sem campanha (posts legítimos de outros fluxos).
  let storyQuery = admin
    .from("scheduled_posts")
    .select(SELECT_FIELDS)
    .eq("status", "pending")
    .eq("post_type", "story")
    .lte("scheduled_at", now)
    .not("video_url", "ilike", "%instagram.com%");
  if (pausedFilter) storyQuery = storyQuery.or(pausedFilter);
  const { data: storyRows, error: storyErr } = await storyQuery
    .order("scheduled_at", { ascending: true })
    .limit(BATCH_SIZE);

  if (storyErr) {
    console.error("[publish-scheduled] Erro ao buscar stories:", storyErr.message);
    return NextResponse.json({ error: storyErr.message }, { status: 500 });
  }

  const remainingSlots = BATCH_SIZE - (storyRows?.length ?? 0);
  let otherRows: unknown[] = [];
  if (remainingSlots > 0) {
    let otherQuery = admin
      .from("scheduled_posts")
      .select(SELECT_FIELDS)
      .eq("status", "pending")
      .neq("post_type", "story")
      .lte("scheduled_at", now)
      .not("video_url", "ilike", "%instagram.com%");
    if (pausedFilter) otherQuery = otherQuery.or(pausedFilter);
    const { data, error: fetchErr } = await otherQuery
      .order("scheduled_at", { ascending: true })
      .limit(remainingSlots);

    if (fetchErr) {
      console.error("[publish-scheduled] Erro ao buscar posts:", fetchErr.message);
      return NextResponse.json({ error: fetchErr.message }, { status: 500 });
    }
    otherRows = data ?? [];
  }

  const rawPosts = [...(storyRows ?? []), ...otherRows] as unknown as PostRow[];

  // ── Filtro de campanha ativa em memória (sem FK no schema cache) ─────────
  // Coleta campaign_ids únicos do batch, busca status em distribute_campaigns
  // e filtra posts cuja campanha não esteja 'active'. Posts sem campaign_id
  // passam direto (fluxos Loop/Clonar/Postar manual).
  const campaignIds = [
    ...new Set(rawPosts.map((p) => p.campaign_id).filter(Boolean)),
  ] as string[];

  const campaignStatusMap = new Map<string, string>();
  if (campaignIds.length > 0) {
    const { data: campaigns, error: campErr } = await admin
      .from("distribute_campaigns")
      .select("id, status")
      .in("id", campaignIds);

    if (campErr) {
      console.warn(
        "[publish-scheduled] ⚠ Falha ao buscar campanhas para filtro:",
        campErr.message,
      );
      // Em caso de falha, permite todos os posts para não bloquear a fila;
      // o filtro é uma otimização de atomicidade, não um gate de segurança.
    } else {
      for (const c of campaigns ?? []) {
        campaignStatusMap.set(c.id, c.status);
      }
    }
  }

  const posts = rawPosts.filter((post) => {
    if (!post.campaign_id) return true; // sem campanha → legítimo
    const status = campaignStatusMap.get(post.campaign_id);
    if (status === "active") return true;
    console.log(
      `[publish-scheduled] ⏭ Post ${post.id} filtrado: campanha ${post.campaign_id} ` +
        `status=${status ?? "não encontrada"} (esperado: active).`,
    );
    return false;
  });
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
    // P1 CORREÇÃO (2026-10-15): Removido filtro is_active.
    // O commit 167cd83 removeu o filtro is_active da UI "Postar" para permitir
    // selecionar contas que existem mas estão com is_active=false (default do
    // banco para contas novas). O cron ainda verificava is_active e rejeitava
    // esses posts, causando falhas silenciosas. Agora só verifica se a conta
    // existe (join retornou dados) — a validação de credenciais Meta abaixo
    // já garante que só publica quem tem token válido.
    if (!account) {
      await admin.from("scheduled_posts").update({ status: "failed", error_message: "Conta não encontrada." }).eq("id", post.id);
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

    // Filtro de campanha ativa já aplicado em memória antes do loop
    // (ver bloco "Filtro de campanha ativa em memória" acima).

    attemptedAccounts.add(account.id);

    console.log(
      `[publish-scheduled] Processando post ${post.id} | @${account.username} | ` +
        `creation_id=${post.creation_id ?? "null"} | elapsed=${Math.round((Date.now() - runStart) / 1000)}s`
    );

    // ── CLAIM atômico ──────────────────────────────────────────────────────
    // P1: Registra publishing_started_at no momento do claim para que a
    // recuperação de fila (auto-heal) use o início real do processamento,
    // não o scheduled_at. Um post agendado há 30 min mas iniciado há 10s
    // não deve ser recuperado prematuramente.
    const { data: claimed } = await admin
      .from("scheduled_posts")
      .update({ status: "publishing", publishing_started_at: new Date().toISOString() })
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
            account.fb_page_id
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
        // -- PROCESSAMENTO DE VIDEO: escolha explicita do usuario ------------
        // A decisao foi copiada para a linha do post no momento do agendamento
        // (nunca lida da configuracao atual - mudar a config depois nao altera
        // retroativamente posts ja agendados).
        //
        //   original       -> a URL do arquivo original vai DIRETO pra Meta. Zero FFmpeg.
        //   clean_metadata -> usa a variante (stream copy) preparada pelo cron
        //                    process-videos. Se ainda nao estiver pronta, o post
        //                    volta pra "pending" e tenta no proximo ciclo - nunca
        //                    falha por causa disso, e o FFmpeg nunca roda aqui.
        const mode: VideoProcessingMode = normalizeProcessingMode(post.video_processing_mode);
        let effectiveVideoUrl = rawVideoUrl;

        if (isImageMedia(rawVideoUrl)) {
          console.log(`[publish-scheduled] Imagem de story @${account.username} - sem processamento.`);
        } else {
          const resolution = await resolveMediaUrlForMode(admin, {
            mode,
            sourceUrl: rawVideoUrl,
            sourceVideoId: post.video_id,
            userId: post.user_id,
            scope: `publish-scheduled @${account.username}`,
          });

          if (resolution.status === "pending") {
            await admin
              .from("scheduled_posts")
              .update({ status: "pending", error_message: `[AGUARDANDO] ${resolution.reason}` })
              .eq("id", post.id);
            summary.skipped++;
            console.log(
              `[publish-scheduled] @${account.username} - ${resolution.reason}; publica quando a variante ficar pronta.`
            );
            continue;
          }

          if (resolution.status === "error") {
            // O preparo da versao limpa falhou em definitivo. O post NAO e
            // publicado com o video original: o usuario escolheu clean_metadata
            // e essa escolha e soberana. A linha continua no banco com o motivo,
            // para o usuario decidir (corrigir a midia ou mudar o modo para
            // "Sem limpeza", que e uma acao explicita dele).
            await admin
              .from("scheduled_posts")
              .update({
                status: "failed",
                error_message: `[LIMPEZA DE METADADOS] ${resolution.reason}. O post NAO foi publicado com o video original - mude o modo para "Sem limpeza" se quiser publicar assim.`,
                creation_id: null,
              })
              .eq("id", post.id);
            summary.failed++;
            console.error(
              `[publish-scheduled] @${account.username} - limpeza de metadados falhou: ${resolution.reason}`
            );
            continue;
          }

          effectiveVideoUrl = resolution.url;
        }

        // Guarda de segurança: não deve acontecer com a nova arquitetura
        if (isCloneUrl(effectiveVideoUrl)) {
          console.warn(`[publish-scheduled] ⚠ @${account.username} — clone URL não resolvida no claim, adiando.`);
          await admin.from("scheduled_posts").update({ status: "pending" }).eq("id", post.id);
          summary.skipped++;
          continue;
        }

        console.log(
          `[publish-scheduled] Criando container @${account.username} | ${effectiveVideoUrl.slice(0, 70)}…`
        );
        const mediaType = post.post_type === "story" ? "STORIES" : "REELS";

        // ── Seleção de proxy por publicação (opt-in) ──────────────────────
        // use_proxy_pool=true → seleciona proxy LIVRE do estoque do usuário
        // no momento da execução (round-robin por post_id). A escolha é feita
        // aqui, não no agendamento — proxies mortos/indisponíveis são ignorados.
        // Sem fallback silencioso: se não há proxy ativo, falha explícita.
        let publishProxy: SelectedProxy | null = null;
        if (post.use_proxy_pool === true) {
          publishProxy = await selectProxyForPublish(
            admin,
            post.user_id!,
            post.id,
            post.proxy_pool_id_used
          );
          if (!publishProxy) {
            // Falha explícita — NÃO faz fallback direto silencioso.
            await admin
              .from("scheduled_posts")
              .update({
                status: "failed",
                error_message: "[PROXY] Nenhum proxy ativo disponível no estoque. Desative a opção de proxy ou adicione proxies ao estoque.",
              })
              .eq("id", post.id);
            summary.failed++;
            console.error(
              `[publish-scheduled] ⛔ @${account.username}: use_proxy_pool=true mas nenhum proxy livre no estoque.`
            );
            continue;
          }
          // Salva a seleção para auditoria e para manter o mesmo proxy em retries.
          if (post.proxy_pool_id_used !== publishProxy.poolId) {
            const { error } = await admin
            .from("scheduled_posts")
            .update({ proxy_pool_id_used: publishProxy.poolId })
            .eq("id", post.id);
            if (error) throw new Error(`[PROXY] Falha ao salvar o proxy da publicação: ${error.message}`);
            post.proxy_pool_id_used = publishProxy.poolId;
          }
          console.log(
            `[publish-scheduled] 🔀 @${account.username}: proxy ${publishProxy.safeLabel}… selecionado.`
          );
        }

        try {
          // share_to_feed só existe para Reels; o helper ignora em STORIES.
          creationId = await createMediaContainerOnly(
            account.ig_business_account_id,
            effectiveVideoUrl,
            caption,
            tokenToUse,
            mediaType,
            typeof post.share_to_feed === "boolean" ? post.share_to_feed : null,
            publishProxy?.agent
          );
        } finally {
          await closeProxyAgent(publishProxy);
        }
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
      // Para posts com proxy já registrado (retry), re-seleciona o mesmo proxy
      // para manter consistência nas fases poll/publish.
      let pollProxy: SelectedProxy | null = null;
      if (post.use_proxy_pool === true) {
        pollProxy = await selectProxyForPublish(
          admin,
          post.user_id!,
          post.id,
          post.proxy_pool_id_used
        );
        if (!pollProxy) {
          throw new Error("[PROXY] Nenhum proxy livre e válido no estoque para verificar esta publicação.");
        }
        if (post.proxy_pool_id_used !== pollProxy.poolId) {
          const { error } = await admin
            .from("scheduled_posts")
            .update({ proxy_pool_id_used: pollProxy.poolId })
            .eq("id", post.id);
          if (error) throw new Error(`[PROXY] Falha ao salvar o proxy da publicação: ${error.message}`);
          post.proxy_pool_id_used = pollProxy.poolId;
        }
      }
      let pollStatus: Awaited<ReturnType<typeof pollContainerStatusOnce>>;
      try {
        pollStatus = await pollContainerStatusOnce(creationId, tokenToUse, pollProxy?.agent);
      } finally {
        await closeProxyAgent(pollProxy);
      }

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
      // Re-seleciona proxy para a fase de publicação (mesmo proxy da criação).
      let pubProxy: SelectedProxy | null = null;
      if (post.use_proxy_pool === true) {
        pubProxy = await selectProxyForPublish(
          admin,
          post.user_id!,
          post.id,
          post.proxy_pool_id_used
        );
        if (!pubProxy) {
          throw new Error("[PROXY] Nenhum proxy livre e válido no estoque para publicar.");
        }
        if (post.proxy_pool_id_used !== pubProxy.poolId) {
          const { error } = await admin
            .from("scheduled_posts")
            .update({ proxy_pool_id_used: pubProxy.poolId })
            .eq("id", post.id);
          if (error) throw new Error(`[PROXY] Falha ao salvar o proxy da publicação: ${error.message}`);
          post.proxy_pool_id_used = pubProxy.poolId;
        }
      }
      let mediaId: string;
      try {
        mediaId = await publishReadyContainer(
          account.ig_business_account_id,
          creationId,
          tokenToUse,
          pubProxy?.agent
        );
      } finally {
        await closeProxyAgent(pubProxy);
      }

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
