import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import {
  pollContainerStatusOnce,
  publishReadyContainer,
  updatePostCaption,
} from "@/lib/meta-publish";
import { refreshMetaToken, isTokenExpiringSoon } from "@/lib/meta-refresh";
import { getProxyForAccount } from "@/lib/proxy";

export const runtime = "nodejs";
export const maxDuration = 300;

// 90 min: cobre o atraso inicial máximo de ~48 min (24 contas × 2 min/conta)
// mais 30 min de margem para processamento e retries.
// Antes era 30 min, mas containers com stagger inicial ficavam sendo mortos
// pelo auto-healing no exato momento em que expiravam para publicação.
const CONTAINER_TTL_MS = 90 * 60_000;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// Erros transitórios que disparam backoff exponencial em vez de retry imediato.
// NÃO marcamos como "error" — o container fica "pending" com retry_after no futuro.
const RETRYABLE_META_ERRORS = [
  "too many actions",
  "an unexpected error has occurred",
  "retry your request later",
  "please retry",
  "service unavailable",
  "internal server error",
];

function isRetryableMetaError(msg: string): boolean {
  const lower = msg.toLowerCase();
  return RETRYABLE_META_ERRORS.some(p => lower.includes(p));
}

interface AccountRow {
  id: string;
  username: string;
  meta_access_token: string | null;
  token_expires_at: string | null;
  fb_page_id: string | null;
  proxy_url?: string | null;
}

interface PendingContainerRow {
  id: string;
  user_id: string;
  account_id: string;
  ig_business_account_id: string;
  creation_id: string;
  caption: string;
  created_at: string;
  retry_count: number;
  retry_after: string | null;
  instagram_accounts: AccountRow | null;
}

export async function GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization");
  if (cronSecret && auth !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
    return NextResponse.json({ skipped: true, reason: "Supabase não configurado." });
  }

  const admin = getSupabaseAdmin();
  const now = new Date();
  const nowIso = now.toISOString();
  const summary = { checked: 0, published: 0, in_progress: 0, expired: 0, errors: 0, auto_healed: 0 };

  // ── AUTO-HEALING: Containers expirados (>30 min em pending/publishing) ──────
  // Exclui containers explicitamente em backoff (retry_after > now) —
  // esses estão aguardando intencionalmente e NÃO devem ser mortos como erro.
  {
    const healCutoff = new Date(now.getTime() - CONTAINER_TTL_MS).toISOString();
    const { data: healed, error: healErr } = await (admin as any)
      .from("pending_containers")
      .update({
        status: "error",
        error_message: "[AUTO-HEALING] Container preso >30 min em pending/publishing — desbloqueado.",
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

  // Busca apenas containers elegíveis: pending + fora do período de backoff
  const { data: rows, error: fetchErr } = await (admin as any)
    .from("pending_containers")
    .select(`
      id, user_id, account_id, ig_business_account_id,
      creation_id, caption, created_at, retry_count, retry_after,
      instagram_accounts (
        id, username, meta_access_token, token_expires_at, fb_page_id, proxy_url
      )
    `)
    .eq("status", "pending")
    .or(`retry_after.is.null,retry_after.lte.${nowIso}`)
    .order("created_at", { ascending: true })
    .limit(5); // 5 max — 5 × (8s delay + ~5s API) = ~65s, dentro do maxDuration

  if (fetchErr) {
    console.error("[publish-pending] Erro ao buscar containers:", fetchErr.message);
    return NextResponse.json({ error: fetchErr.message }, { status: 500 });
  }

  const containers = (rows ?? []) as PendingContainerRow[];
  console.log(`[publish-pending] ${containers.length} container(s) elegíveis.`);

  // Delay de 8s entre publishes (anti-burst).
  // A Meta bloqueia com "too many actions" com intervalos < 5s entre publicações.
  let publishAttemptsInThisRun = 0;

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
          error_message: "Expirado: Meta não terminou de processar em 30 minutos.",
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

    try {
      const proxy = getProxyForAccount(account.id, account.proxy_url);
      let tokenToUse = account.meta_access_token;

      if (isTokenExpiringSoon(account.token_expires_at, 7)) {
        try {
          const { token, expiresAt } = await refreshMetaToken(
            account.meta_access_token,
            account.fb_page_id,
            proxy
          );
          await (admin as any)
            .from("instagram_accounts")
            .update({ meta_access_token: token, token_expires_at: expiresAt.toISOString() })
            .eq("id", account.id);
          tokenToUse = token;
        } catch {
          console.warn(`[publish-pending] Falha ao renovar token de @${account.username}.`);
        }
      }

      const pollStatus = await pollContainerStatusOnce(container.creation_id, tokenToUse, proxy);

      if (pollStatus === "in_progress") {
        await (admin as any)
          .from("pending_containers")
          .update({ status: "pending" })
          .eq("id", container.id);
        summary.in_progress++;
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

      const mediaId = await publishReadyContainer(
        container.ig_business_account_id,
        container.creation_id,
        tokenToUse,
        proxy
      );

      await (admin as any)
        .from("pending_containers")
        .update({ status: "published", media_id: mediaId })
        .eq("id", container.id);

      summary.published++;
      console.log(`[publish-pending] ✓ @${account.username} → media_id: ${mediaId}`);

      const captionStored = container.caption ?? "";
      console.log(
        `[publish-pending] legenda_armazenada @${account.username}: ` +
        (captionStored.trim()
          ? `${captionStored.length} char(s) — "${captionStored.slice(0, 80)}${captionStored.length > 80 ? "…" : ""}"`
          : "VAZIA — post será publicado sem legenda")
      );

      // Double-tap de legenda: 5s de delay (Reel finaliza rápido após publish).
      if (captionStored.trim()) {
        await sleep(5_000);

        let captionApplied = false;
        for (let attempt = 1; attempt <= 3 && !captionApplied; attempt++) {
          try {
            await updatePostCaption(mediaId, captionStored, tokenToUse, proxy);
            captionApplied = true;
            console.log(`[publish-pending] ✓ Legenda aplicada @${account.username} (tentativa ${attempt})`);
          } catch (captionErr) {
            const captMsg = captionErr instanceof Error ? captionErr.message : String(captionErr);
            if (attempt < 3) {
              console.warn(
                `[publish-pending] Legenda tentativa ${attempt}/3 falhou @${account.username}: ` +
                `"${captMsg}" — aguardando 4s…`
              );
              await sleep(4_000);
            } else {
              console.error(
                `[publish-pending] ✗ Legenda NÃO aplicada @${account.username} após 3 tentativas: ` +
                `"${captMsg}" | media_id=${mediaId} | caption="${captionStored.slice(0, 100)}"`
              );
            }
          }
        }
      }

    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[publish-pending] ✗ container ${container.id}:`, msg);
      summary.errors++;

      if (isRetryableMetaError(msg)) {
        // Backoff exponencial: 10, 20, 40, 60 min (cap em 60) + jitter 0–5 min.
        // O jitter garante que containers criados no mesmo batch não saiam do backoff
        // simultaneamente (thundering herd) e causem novo rate-limit em cascata.
        const retryCount = (container.retry_count ?? 0) + 1;
        const backoffMinutes = Math.min(60, 10 * Math.pow(2, retryCount - 1));
        // Jitter 0–20 min: containers criados no mesmo batch saem do backoff
        // em momentos distintos, evitando novo burst simultâneo após o cooldown.
        const jitterMs = Math.floor(Math.random() * 20 * 60_000);
        const retryAfter = new Date(Date.now() + backoffMinutes * 60_000 + jitterMs).toISOString();
        await (admin as any)
          .from("pending_containers")
          .update({ status: "pending", retry_count: retryCount, retry_after: retryAfter })
          .eq("id", container.id);
        console.warn(
          `[publish-pending] Backoff @${account?.username ?? "?"}: ` +
          `retry_count=${retryCount}, retry_after=${retryAfter} (+${backoffMinutes}min). Motivo: "${msg}"`
        );
      } else {
        await (admin as any)
          .from("pending_containers")
          .update({ status: "error", error_message: msg })
          .eq("id", container.id);
      }
    }
  }

  console.log("[publish-pending] Resumo:", summary);
  return NextResponse.json({ ok: true, ...summary });
}
