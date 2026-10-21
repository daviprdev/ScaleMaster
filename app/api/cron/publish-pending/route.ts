import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import {
  pollContainerStatusOnce,
  publishReadyContainer,
} from "@/lib/meta-publish";
import { refreshMetaToken, isTokenExpiringSoon } from "@/lib/meta-refresh";
import { isAccountDeadError, markDeadAccounts, type DeadAccountCandidate } from "@/lib/account-health";
import { requireCronAuth } from "@/lib/cron-auth";
import {
  selectProxyForPublish,
  closeProxyAgent,
  type SelectedProxy,
} from "@/lib/publish-proxy-selector";
import { vpsPublishDispatcher } from "@/lib/vps-publish-proxy";

export const runtime = "nodejs";
export const maxDuration = 300;

// 90 min: cobre o atraso inicial máximo (stagger dinâmico = interval_minutes por loop).
// Containers com stagger inicial (retry_after futuro no INSERT) não devem ser mortos
// antes de chegarem ao publish-pending.
const CONTAINER_TTL_MS = 90 * 60_000;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** 42703 (Postgres) / PGRST204 (PostgREST) ou mensagem citando published_at = fila_ideal.sql ainda não aplicado. */
function isMissingPublishedAtColumn(
  err: { code?: string | null; message?: string | null } | null | undefined,
): boolean {
  if (!err) return false;
  return err.code === "42703" || err.code === "PGRST204" || (err.message ?? "").includes("published_at");
}

interface AccountRow {
  id: string;
  username: string;
  meta_access_token: string | null;
  token_expires_at: string | null;
  fb_page_id: string | null;
}

interface PendingContainerRow {
  id: string;
  user_id: string;
  account_id: string;
  ig_business_account_id: string;
  creation_id: string;
  caption: string;
  created_at: string;
  retry_after: string | null;
  use_proxy_pool: boolean | null;
  proxy_pool_id_used: string | null;
  instagram_accounts: AccountRow | null;
}

export async function GET(req: NextRequest) {
  const cronAuth = requireCronAuth(req);
  if (!cronAuth.ok) return cronAuth.response;

  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
    return NextResponse.json({ skipped: true, reason: "Supabase não configurado." });
  }

  const admin = getSupabaseAdmin();
  const now = new Date();
  const nowIso = now.toISOString();
  const summary = { checked: 0, published: 0, in_progress: 0, expired: 0, errors: 0, auto_healed: 0 };

  // ── AUTO-HEALING: Containers expirados (>90 min em pending/publishing) ──────
  // Exclui containers com stagger inicial ainda pendente (retry_after > now) —
  // esses foram criados com atraso intencional e NÃO devem ser mortos antes de serem publicados.
  {
    const healCutoff = new Date(now.getTime() - CONTAINER_TTL_MS).toISOString();
    const { data: healed, error: healErr } = await (admin as any)
      .from("pending_containers")
      .update({
        status: "error",
        error_message: "[AUTO-HEALING] Container preso >90 min em pending/publishing — desbloqueado.",
      })
      .in("status", ["pending", "publishing"])
      .lt("created_at", healCutoff)
      .or(`retry_after.is.null,retry_after.lte.${nowIso}`)
      .select("id");

    if (healErr) {
      console.warn("[AUTO-HEALING] publish-pending: falha ao desbloquear containers:", healErr.message);
    } else {
      const healedCount = healed?.length ?? 0;
      if (healedCount > 0) {
        console.log(`[AUTO-HEALING] Destravando ${healedCount} container(s) presos.`);
        summary.auto_healed = healedCount;
      }
    }
  }

  // Busca containers elegíveis: pending + stagger inicial expirado (retry_after <= now)
  const { data: rows, error: fetchErr } = await (admin as any)
    .from("pending_containers")
    .select(`
      id, user_id, account_id, ig_business_account_id,
      creation_id, caption, created_at, retry_after, use_proxy_pool, proxy_pool_id_used,
      instagram_accounts (
        id, username, meta_access_token, token_expires_at, fb_page_id
      )
    `)
    .eq("status", "pending")
    .or(`retry_after.is.null,retry_after.lte.${nowIso}`)
    .order("created_at", { ascending: true })
    .limit(20); // 20 max a cada 2min — cobre demanda de dezenas de contas em loops de 30min sem acumular fila (ver CLAUDE.md 2026-08-31)

  if (fetchErr) {
    console.error("[publish-pending] Erro ao buscar containers:", fetchErr.message);
    return NextResponse.json({ error: fetchErr.message }, { status: 500 });
  }

  const containers = (rows ?? []) as PendingContainerRow[];
  console.log(`[publish-pending] ${containers.length} container(s) elegíveis.`);

  // Delay de 8s entre publishes (anti-burst).
  // A Meta bloqueia com "too many actions" com intervalos < 5s entre publicações.
  let publishAttemptsInThisRun = 0;

  // Detecção passiva de conta caída (2026-07-17): contas cujo publish falha com
  // erro inequívoco de checkpoint/token morto são marcadas após o loop, com
  // guarda de cascata (lib/account-health.ts).
  const attemptedAccounts = new Set<string>();
  const deadCandidates: DeadAccountCandidate[] = [];

  for (const container of containers) {
    summary.checked++;

    // ── Claim atômico: pending → publishing ───────────────────────────────────
    {
      const { data: claimed } = await (admin as any)
        .from("pending_containers")
        .update({ status: "publishing" })
        .eq("id", container.id)
        .eq("status", "pending")
        .select("id");

      if (!claimed?.length) {
        console.log(`[publish-pending] Container ${container.id}: já reivindicado por invocação concorrente — pulando.`);
        continue;
      }
    }

    // Expire containers stuck too long
    const age = now.getTime() - new Date(container.created_at).getTime();
    if (age > CONTAINER_TTL_MS) {
      await (admin as any)
        .from("pending_containers")
        .update({
          status: "error",
          error_message: "Expirado: Meta não terminou de processar em 90 minutos.",
        })
        .eq("id", container.id);
      console.warn(`[publish-pending] Container ${container.id} expirado após ${Math.round(age / 60_000)} min.`);
      summary.expired++;
      continue;
    }

    // Guard: creation_id vazio indica container criado em modo de erro — descartar.
    if (!container.creation_id) {
      await (admin as any)
        .from("pending_containers")
        .update({ status: "error", error_message: "creation_id vazio — container inválido, descartado." })
        .eq("id", container.id);
      console.warn(`[publish-pending] Container ${container.id}: creation_id vazio — descartado.`);
      summary.errors++;
      continue;
    }

    const account = container.instagram_accounts;
    if (!account?.meta_access_token) {
      await (admin as any)
        .from("pending_containers")
        .update({ status: "error", error_message: "Conta sem token de acesso." })
        .eq("id", container.id);
      summary.errors++;
      continue;
    }

    attemptedAccounts.add(account.id);

    try {
      let tokenToUse = account.meta_access_token;

      if (isTokenExpiringSoon(account.token_expires_at, 7)) {
        try {
          const { token, expiresAt } = await refreshMetaToken(account.meta_access_token, account.fb_page_id);
          await (admin as any)
            .from("instagram_accounts")
            .update({ meta_access_token: token, token_expires_at: expiresAt.toISOString() })
            .eq("id", account.id);
          tokenToUse = token;
        } catch {
          console.warn(`[publish-pending] Falha ao renovar token de @${account.username}.`);
        }
      }

      // ── Seleção de proxy por publicação (opt-in) ──────────────────────
      // O valor é snapshot da configuração do loop no momento em que o container foi criado.
      let pendingProxy: SelectedProxy | null = null;
      let proxyPoolIdUsed = container.proxy_pool_id_used;
      if (container.use_proxy_pool === true) {
        pendingProxy = await selectProxyForPublish(
          admin,
          container.user_id,
          container.id,
          proxyPoolIdUsed
        );
        if (!pendingProxy) {
          throw new Error("[PROXY] Nenhum proxy livre e válido no estoque para esta publicação.");
        }
        if (pendingProxy.poolId !== proxyPoolIdUsed) {
          proxyPoolIdUsed = pendingProxy.poolId;
          const { error } = await (admin as any)
            .from("pending_containers")
            .update({ proxy_pool_id_used: proxyPoolIdUsed })
            .eq("id", container.id);
          if (error) throw new Error(`[PROXY] Falha ao salvar proxy da publicação: ${error.message}`);
        }
      }
      let pollStatus: Awaited<ReturnType<typeof pollContainerStatusOnce>>;
      try {
        pollStatus = await pollContainerStatusOnce(
          container.creation_id,
          tokenToUse,
          pendingProxy?.agent ?? (await vpsPublishDispatcher(container.id))
        );
      } finally {
        await closeProxyAgent(pendingProxy);
      }

      if (pollStatus === "in_progress") {
        // Throttle de poll: aguarda 2 min antes do próximo check.
        // Sem isso, cada container IN_PROGRESS recebe 1 GET/min na Meta API.
        // Com 10 containers aguardando = 10 calls/min = 600 calls/hora só de poll.
        // A 2 min de intervalo: 5 calls/min por container = 300 calls/hora (−50%).
        const pollAfter = new Date(Date.now() + 2 * 60_000).toISOString();
        await (admin as any)
          .from("pending_containers")
          .update({ status: "pending", retry_after: pollAfter })
          .eq("id", container.id);
        summary.in_progress++;
        console.log(`[publish-pending] ⏳ @${account?.username}: IN_PROGRESS — próximo poll em 2min.`);
        continue;
      }

      if (pollStatus === "error") {
        await (admin as any)
          .from("pending_containers")
          .update({
            status: "error",
            error_message: "Meta retornou ERROR/EXPIRED durante o processamento do vídeo.",
          })
          .eq("id", container.id);
        console.error(`[publish-pending] ✗ container ${container.id}: Meta ERROR/EXPIRED.`);
        summary.errors++;
        continue;
      }

      // FINISHED — delay anti-burst de 8s antes de cada publish (exceto o primeiro).
      if (publishAttemptsInThisRun > 0) {
        await sleep(8_000);
      }
      publishAttemptsInThisRun++;

      // Re-seleciona proxy para a fase de publicação (mesmo proxy do poll).
      let pubProxy: SelectedProxy | null = null;
      if (container.use_proxy_pool === true) {
        pubProxy = await selectProxyForPublish(
          admin,
          container.user_id,
          container.id,
          proxyPoolIdUsed
        );
        if (!pubProxy) {
          throw new Error("[PROXY] Proxy desta publicação indisponível no estoque.");
        }
        if (pubProxy.poolId !== proxyPoolIdUsed) {
          proxyPoolIdUsed = pubProxy.poolId;
          const { error } = await (admin as any)
            .from("pending_containers")
            .update({ proxy_pool_id_used: proxyPoolIdUsed })
            .eq("id", container.id);
          if (error) throw new Error(`[PROXY] Falha ao salvar proxy da publicação: ${error.message}`);
        }
      }
      let mediaId = "";
      try {
        mediaId = await publishReadyContainer(
          container.ig_business_account_id,
          container.creation_id,
          tokenToUse,
          pubProxy?.agent ?? (await vpsPublishDispatcher(container.id))
        );
      } catch (pubErr) {
        const pubMsg = pubErr instanceof Error ? pubErr.message : String(pubErr);
        throw pubErr;
      } finally {
        await closeProxyAgent(pubProxy);
      }

      // published_at = hora real da publicação (Raio-X da fila). A coluna vem de
      // supabase/fila_ideal.sql, aplicado à mão: sem ela, repete sem a coluna.
      const { error: publishedErr } = await (admin as any)
        .from("pending_containers")
        .update({ status: "published", media_id: mediaId, published_at: new Date().toISOString() })
        .eq("id", container.id);
      if (isMissingPublishedAtColumn(publishedErr)) {
        await (admin as any)
          .from("pending_containers")
          .update({ status: "published", media_id: mediaId })
          .eq("id", container.id);
      }

      summary.published++;
      console.log(`[publish-pending] ✓ @${account.username} → media_id: ${mediaId}`);

      const captionStored = container.caption ?? "";
      console.log(
        `[publish-pending] legenda_armazenada @${account.username}: ` +
        (captionStored.trim()
          ? `${captionStored.length} char(s) — "${captionStored.slice(0, 80)}${captionStored.length > 80 ? "…" : ""}"`
          : "VAZIA — post publicado sem legenda (nenhuma legenda configurada no loop)")
      );
      // Double-tap desativado: o endpoint POST /{media-id} aceita o request com HTTP 200
      // mas estava limpando a legenda original do container para Reels (efeito colateral
      // documentado da Meta API v21 quando comment_enabled é enviado junto com caption).
      // A legenda é definida corretamente no createMediaContainer (container creation)
      // e não precisa ser reaplicada após o publish.

    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const lower = msg.toLowerCase();

      // Erros TRANSITÓRIOS: proxy, rate-limit, timeout → retry com backoff 5 min.
      // Não destroem o container — o próximo publish-pending tentará novamente.
      const isTransient = (
        lower.includes("fetch failed") ||
        lower.includes("smartproxy") ||
        lower.includes("proxy") ||
        lower.includes("timeout") ||
        lower.includes("too many actions") ||
        lower.includes("performing too many") ||
        lower.includes("retry your request later") ||
        lower.includes("please retry") ||
        lower.includes("service temporarily unavailable") ||
        lower.includes("an unexpected error has occurred") ||
        // Erros de infraestrutura da Meta: token válido mas servidor Meta falhou
        // ao descriptografar internamente — transitório, retry em 5min.
        lower.includes("failed to decrypt") ||
        lower.includes("cannot parse access token") ||
        lower.includes("malformed access token")
        // Checkpoint REMOVIDO daqui (2026-07-17): checkpoint é conta caída de
        // verdade — cai no branch permanente abaixo e entra em deadCandidates
        // (marcação com guarda de cascata após o loop).
      );

      if (isTransient) {
        const retryAfter = new Date(Date.now() + 5 * 60_000).toISOString();
        console.warn(
          `[publish-pending] ⏸ @${account?.username ?? "?"} container ${container.id}: ` +
          `erro transitório — retry em 5min. Motivo: ${msg.slice(0, 120)}`
        );
        await (admin as any)
          .from("pending_containers")
          .update({ status: "pending", retry_after: retryAfter })
          .eq("id", container.id);
        // Não incrementa summary.errors — é um retry esperado, não uma falha permanente
      } else {
        // Erro PERMANENTE (token inválido, conta restrita, vídeo rejeitado)
        // → FAIL FAST: marca como error, process-loops criará novo container no próximo ciclo.
        console.error(`[publish-pending] ✗ FAIL FAST @${account?.username ?? "?"} container ${container.id}: ${msg}`);
        summary.errors++;
        await (admin as any)
          .from("pending_containers")
          .update({ status: "error", error_message: msg.slice(0, 500) })
          .eq("id", container.id);
        // Conta caída de verdade (checkpoint/token morto) → candidata a vermelho.
        if (account && isAccountDeadError(msg)) {
          deadCandidates.push({
            accountId: account.id,
            username: account.username,
            userId: container.user_id,
            reason: msg,
          });
        }
      }
    }
  }

  // Marcação passiva de saúde — com guarda de cascata (outage não marca ninguém).
  await markDeadAccounts(admin, "publish-pending", deadCandidates, attemptedAccounts.size);

  console.log("[publish-pending] Resumo:", summary);
  return NextResponse.json({ ok: true, ...summary });
}

