import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import {
  createMediaContainerOnly,
  pollContainerStatusOnce,
  publishReadyContainer,
} from "@/lib/meta-publish";
import { refreshMetaToken, isTokenExpiringSoon } from "@/lib/meta-refresh";
import { getProxyForAccount } from "@/lib/proxy";

export const runtime = "nodejs";
export const maxDuration = 300;

// Orçamento de tempo — Hobby plan: 60s real.
// Dois-fase: criar container (rápido) + poll uma vez (rápido) + publicar (rápido).
// Nenhuma operação de poll com loop — sempre retorna e tenta de novo no próximo ciclo (1min).
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
  // Criado na primeira tentativa e reutilizado em polls subsequentes.
  // NULL = ainda não criou container. Não-null = container já existe na Meta.
  creation_id: string | null;
  instagram_accounts: AccountRow | null;
  videos_library: { public_url: string } | null;
}

// Erros transitórios da Meta ou de rede → manter creation_id, tentar de novo no próximo ciclo.
// Erros de token/credenciais → marcar como "failed" permanente, limpar creation_id.
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
];

function isTransientError(msg: string): boolean {
  const lower = msg.toLowerCase();
  return TRANSIENT_PATTERNS.some(p => lower.includes(p));
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

  console.log(`[publish-scheduled] ▶ Iniciando execução (dois-fase). now=${now} | batch_size=${BATCH_SIZE}`);

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
    `  ├─ elegíveis agora:   ${countEligible ?? 0}  (scheduled_at ≤ ${now})\n` +
    `  ├─ data futura:       ${countFuture}  (aguardando horário agendado)\n` +
    `  ├─ em publicação:     ${countPublishing ?? 0}\n` +
    `  └─ falhas acumuladas: ${countFailed ?? 0}`
  );

  // ── Desbloqueio de posts presos em "publishing" ───────────────────────────
  // Com dois-fase, NÃO limpamos creation_id — próximo ciclo vai pollar o mesmo container.
  // Apenas reseta o status para "pending" para que seja reprocessado.
  const stuckCutoff = new Date(Date.now() - 10 * 60_000).toISOString();
  const { data: unblocked, error: unblockErr } = await admin
    .from("scheduled_posts")
    .update({ status: "pending", error_message: null })
    // NÃO inclui creation_id aqui — mantém o container existente para re-poll
    .eq("status", "publishing")
    .lte("scheduled_at", stuckCutoff)
    .select("id");

  if (unblockErr) {
    console.error("[publish-scheduled] Erro ao desbloquear posts presos:", unblockErr.message);
  } else if (unblocked?.length) {
    console.log(`[publish-scheduled] ${unblocked.length} post(s) desbloqueados "publishing" → "pending" (creation_id preservado)`);
  }

  // ── Busca posts elegíveis ─────────────────────────────────────────────────
  // Inclui creation_id — se não-null, o container já existe na Meta (não recriar).
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
    queue_pending: countPending ?? 0,
    queue_eligible: countEligible ?? 0,
    queue_future: countFuture,
    queue_failed_total: countFailed ?? 0,
  };

  let publishAttemptsInThisRun = 0;

  for (const post of posts) {
    // ── Budget global da execução ─────────────────────────────────────────
    const elapsed = Date.now() - runStart;
    if (elapsed > RUN_BUDGET_MS) {
      console.log(`[publish-scheduled] ⏱ Budget esgotado (${Math.round(elapsed / 1000)}s). Posts restantes serão processados na próxima execução.`);
      break;
    }

    console.log(
      `[publish-scheduled] Processando post ${post.id} | ` +
      `scheduled_at=${post.scheduled_at} | ` +
      `creation_id=${post.creation_id ?? "null (novo)"} | ` +
      `elapsed=${Math.round(elapsed / 1000)}s`
    );

    // Claim atômico: evita dupla publicação em execuções concorrentes
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

    const account = post.instagram_accounts;
    const videoUrl = post.video_url ?? post.videos_library?.public_url ?? null;

    if (!account || !account.is_active) {
      const reason = "Conta não encontrada ou inativa.";
      console.error(`[publish-scheduled] ✗ Post ${post.id}: ${reason}`);
      await admin.from("scheduled_posts").update({ status: "failed", error_message: reason }).eq("id", post.id);
      summary.failed++;
      continue;
    }

    if (!videoUrl) {
      const reason = "URL do vídeo não encontrada.";
      console.error(`[publish-scheduled] ✗ Post ${post.id} (@${account.username}): ${reason}`);
      await admin.from("scheduled_posts").update({ status: "failed", error_message: reason }).eq("id", post.id);
      summary.failed++;
      continue;
    }

    if (!account.meta_access_token || !account.ig_business_account_id) {
      const reason = "Conta sem credenciais Meta. Reconecte a conta em Contas.";
      console.error(`[publish-scheduled] ✗ Post ${post.id} (@${account.username}): ${reason}`);
      await admin.from("scheduled_posts").update({ status: "failed", error_message: reason }).eq("id", post.id);
      summary.failed++;
      continue;
    }

    const caption = post.caption ?? "";
    const proxy = getProxyForAccount(account.id, account.proxy_url ?? null);

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
      // Se creation_id já existe, o container foi criado em ciclo anterior.
      // Apenas pollamos — evita criação de novos containers a cada minuto (causa de rate-limit).
      let creationId = post.creation_id;

      if (!creationId) {
        console.log(`[publish-scheduled] Criando container Meta para @${account.username} | proxy=${proxy ? "sim" : "não"} | videoUrl=${videoUrl.slice(0, 80)}...`);
        creationId = await createMediaContainerOnly(
          account.ig_business_account_id,
          videoUrl,
          caption,
          tokenToUse,
          proxy
        );
        // Persiste imediatamente para que falhas subsequentes não recriem o container.
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
      // Sem loop de poll — retorna imediatamente e tenta de novo no próximo ciclo (1 min).
      // Elimina o timeout de 24s que causava re-criação infinita de containers.
      const pollStatus = await pollContainerStatusOnce(creationId, tokenToUse, proxy);

      if (pollStatus === "in_progress") {
        // Meta ainda processando o vídeo → volta para pending (mantém creation_id)
        await admin
          .from("scheduled_posts")
          .update({ status: "pending", error_message: null })
          .eq("id", post.id);
        summary.in_progress++;
        console.log(`[publish-scheduled] ⏳ @${account.username}: vídeo em processamento (IN_PROGRESS) — tentará de novo no próximo ciclo.`);
        continue;
      }

      if (pollStatus === "error") {
        // Meta rejeitou o vídeo (formato inválido, violação de política, etc.) — permanente.
        // Limpa creation_id para que uma nova tentativa manual recrie o container.
        await admin
          .from("scheduled_posts")
          .update({ status: "failed", error_message: "Meta retornou ERROR/EXPIRED durante o processamento do vídeo.", creation_id: null })
          .eq("id", post.id);
        console.error(`[publish-scheduled] ✗ @${account.username}: Meta ERROR/EXPIRED no container.`);
        summary.failed++;
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
      console.log(`[publish-scheduled] ✓ @${account.username} → media_id: ${mediaId} | elapsed total: ${Math.round((Date.now() - runStart) / 1000)}s`);

    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);

      if (isTransientError(msg)) {
        // Erro transitório (proxy, rate-limit, rede) → volta para pending (mantém creation_id).
        // Salva o erro em error_message para diagnóstico (prefixo [RETRY] indica que vai tentar de novo).
        const retryMsg = `[RETRY] ${msg.slice(0, 300)}`;
        console.warn(`[publish-scheduled] ⏸ @${account.username} (post ${post.id}): erro transitório — retry no próximo ciclo. Motivo: ${msg.slice(0, 120)}`);
        await admin
          .from("scheduled_posts")
          .update({ status: "pending", error_message: retryMsg })
          .eq("id", post.id);
        summary.skipped++;
      } else {
        // Erro permanente (token inválido, container expirado, vídeo rejeitado)
        // Limpa creation_id para forçar re-criação na próxima tentativa manual.
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
