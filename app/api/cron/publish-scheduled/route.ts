import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { publishViaMetaAPI } from "@/lib/meta-publish";
import { refreshMetaToken, isTokenExpiringSoon } from "@/lib/meta-refresh";
import { getProxyForAccount } from "@/lib/proxy";
import type { MetaPublishResult } from "@/lib/meta-publish";

export const runtime = "nodejs";
export const maxDuration = 300;

// ── Orçamento de tempo anti-timeout ───────────────────────────────────────────
// Hobby plan: serverless Node.js → 60s real. maxDuration=300 é o plano ideal
// (Pro), mas assumimos 60s como piso seguro.
// Cada post pode esperar no máximo 50s (pollContainerStatus: 6×8s = 48s + overhead).
// Com BATCH_SIZE=5 e RUN_BUDGET_MS=55s paramos de aceitar novos posts antes
// do kill do servidor, garantindo que o status seja gravado no DB.
const BATCH_SIZE = 10;
const RUN_BUDGET_MS = 55_000;   // para de clamar novos posts após 55s
const PER_POST_TIMEOUT_MS = 50_000; // hard cap por post

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
  instagram_accounts: AccountRow | null;
  videos_library: { public_url: string } | null;
}

// Erros de rate limit da Meta → resetar para "pending" (retentável no próximo ciclo).
// Erros de token/credenciais → marcar como "failed" (permanente).
const RATE_LIMIT_PATTERNS = [
  "too many actions",
  "an unexpected error has occurred",
  "retry your request later",
  "please retry",
  "service unavailable",
  "internal server error",
  "fetch failed",
  "smartproxy",
];

function isRateLimitError(msg: string): boolean {
  const lower = msg.toLowerCase();
  return RATE_LIMIT_PATTERNS.some(p => lower.includes(p));
}

// Envolve publishViaMetaAPI num hard-timeout.
// Se estourar: lança erro marcado com "[TIMEOUT]" para o catch saber que
// deve resetar o status para "pending" (reprocessável) e não "failed".
function publishWithTimeout(
  igAccountId: string,
  token: string,
  videoUrl: string,
  caption: string,
  proxy: import("undici").ProxyAgent | null
): Promise<MetaPublishResult> {
  return Promise.race([
    publishViaMetaAPI(igAccountId, token, videoUrl, caption, proxy),
    new Promise<MetaPublishResult>((_, reject) =>
      setTimeout(
        () => reject(new Error("[TIMEOUT] Meta API não processou em 50s — será reprocessado.")),
        PER_POST_TIMEOUT_MS
      )
    ),
  ]);
}

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
    `  ├─ elegíveis agora:   ${countEligible ?? 0}  (scheduled_at ≤ ${now})\n` +
    `  ├─ data futura:       ${countFuture}  (aguardando horário agendado)\n` +
    `  ├─ em publicação:     ${countPublishing ?? 0}\n` +
    `  └─ falhas acumuladas: ${countFailed ?? 0}`
  );

  // ── Desbloqueio de posts presos em "publishing" ───────────────────────────
  // Cutoff de 10 min: se o worker anterior morreu antes de atualizar o status,
  // o post fica preso. Resetamos após 10 min para reprocessar na próxima execução.
  const stuckCutoff = new Date(Date.now() - 10 * 60_000).toISOString();
  const { data: unblocked, error: unblockErr } = await admin
    .from("scheduled_posts")
    .update({ status: "pending", error_message: null })
    .eq("status", "publishing")
    .lte("scheduled_at", stuckCutoff)
    .select("id");

  if (unblockErr) {
    console.error("[publish-scheduled] Erro ao desbloquear posts presos:", unblockErr.message);
  } else if (unblocked?.length) {
    console.log(`[publish-scheduled] ${unblocked.length} post(s) desbloqueados "publishing" → "pending" (presos > 10 min)`);
  }

  // ── Busca posts elegíveis ─────────────────────────────────────────────────
  // BATCH_SIZE=5 para garantir que processamos dentro do orçamento de 60s.
  // Os posts restantes serão processados nas próximas execuções do cron.
  const { data: rows, error: fetchErr } = await admin
    .from("scheduled_posts")
    .select(
      "id, video_id, video_url, caption, scheduled_at, account_id, " +
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
    failed: 0,
    skipped: 0,
    timed_out: 0,
    unblocked: unblocked?.length ?? 0,
    queue_pending: countPending ?? 0,
    queue_eligible: countEligible ?? 0,
    queue_future: countFuture,
    queue_failed_total: countFailed ?? 0,
  };

  for (const post of posts) {
    // ── Budget global da execução ─────────────────────────────────────────
    const elapsed = Date.now() - runStart;
    if (elapsed > RUN_BUDGET_MS) {
      console.log(`[publish-scheduled] ⏱ Budget esgotado (${Math.round(elapsed / 1000)}s). Posts restantes serão processados na próxima execução.`);
      break;
    }

    console.log(`[publish-scheduled] Processando post ${post.id} | scheduled_at=${post.scheduled_at} | elapsed=${Math.round(elapsed / 1000)}s`);

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

      console.log(`[publish-scheduled] Publicando via Meta API para @${account.username} (ig_id=${account.ig_business_account_id}) | proxy=${proxy ? "sim" : "não"} | videoUrl=${videoUrl.slice(0, 80)}...`);

      const result = await publishWithTimeout(
        account.ig_business_account_id,
        tokenToUse,
        videoUrl,
        caption,
        proxy
      );

      if (result.status !== "ok") {
        throw new Error(result.error ?? "Erro desconhecido na Meta API.");
      }

      await admin
        .from("scheduled_posts")
        .update({
          status: "published",
          published_at: new Date().toISOString(),
          media_id: result.media_id ?? null,
          error_message: null,
        })
        .eq("id", post.id);

      summary.published++;
      console.log(`[publish-scheduled] ✓ @${account.username} → media_id: ${result.media_id} | elapsed total: ${Math.round((Date.now() - runStart) / 1000)}s`);

    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const isTimeout = msg.startsWith("[TIMEOUT]");
      const isRateLimit = isRateLimitError(msg);

      if (isTimeout || isRateLimit) {
        // Erros transitórios → resetar para "pending" (retentável no próximo ciclo a cada 5 min).
        const kind = isTimeout ? "timeout" : "rate-limit";
        console.warn(`[publish-scheduled] ⏱ @${account.username} (post ${post.id}): ${kind} — resetando para pending.`);
        await admin
          .from("scheduled_posts")
          .update({ status: "pending", error_message: null })
          .eq("id", post.id);
        if (isTimeout) summary.timed_out++; else summary.failed++;
      } else {
        // Erro permanente (credenciais inválidas, vídeo rejeitado pela Meta, etc.)
        console.error(`[publish-scheduled] ✗ @${account.username} (post ${post.id}):`, msg);
        await admin
          .from("scheduled_posts")
          .update({ status: "failed", error_message: msg })
          .eq("id", post.id);
        summary.failed++;
      }
    }
  }

  const totalElapsed = Math.round((Date.now() - runStart) / 1000);
  console.log(`[publish-scheduled] ■ Resumo (${totalElapsed}s):`, summary);
  return NextResponse.json({ ok: true, elapsed_seconds: totalElapsed, ...summary });
}
