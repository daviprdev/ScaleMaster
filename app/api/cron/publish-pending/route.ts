import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import {
  pollContainerStatusOnce,
  publishReadyContainer,
  updatePostCaption,
} from "@/lib/meta-publish";
import { refreshMetaToken, isTokenExpiringSoon } from "@/lib/meta-refresh";

export const runtime = "nodejs";
export const maxDuration = 300;

const CONTAINER_TTL_MS = 30 * 60_000;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// Erros transitórios da Meta API que devem ser retentados no próximo ciclo.
// NÃO marcamos como "error" — o container fica em "pending" e o próximo
// disparo do cron (em 5 min) tenta novamente automaticamente.
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
}

interface PendingContainerRow {
  id: string;
  user_id: string;
  account_id: string;
  ig_business_account_id: string;
  creation_id: string;
  caption: string;
  created_at: string;
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
  const summary = { checked: 0, published: 0, in_progress: 0, expired: 0, errors: 0, auto_healed: 0 };

  // ── AUTO-HEALING: Containers expirados (>30 min em pending/publishing) ──────
  // Inclui 'publishing' para recuperar containers cujo cron invocador fez timeout
  // sem concluir — sem isso ficariam presos em 'publishing' para sempre.
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

  const { data: rows, error: fetchErr } = await (admin as any)
    .from("pending_containers")
    .select(`
      id, user_id, account_id, ig_business_account_id,
      creation_id, caption, created_at,
      instagram_accounts (
        id, username, meta_access_token, token_expires_at, fb_page_id
      )
    `)
    .eq("status", "pending")
    .order("created_at", { ascending: true })
    .limit(10); // 10 max: pior caso 10 FINISHED × ~15s = 150s << maxDuration 300s

  if (fetchErr) {
    console.error("[publish-pending] Erro ao buscar containers:", fetchErr.message);
    return NextResponse.json({ error: fetchErr.message }, { status: 500 });
  }

  const containers = (rows ?? []) as PendingContainerRow[];
  console.log(`[publish-pending] ${containers.length} container(s) pendente(s).`);

  // Conta tentativas de publish neste ciclo para inserir delay anti-rate-limit.
  // O delay é aplicado entre TODAS as tentativas (inclusive falhas), não só após sucesso.
  // A Meta bloqueia com "too many actions" quando múltiplas chamadas chegam em burst.
  let publishAttemptsInThisRun = 0;

  for (const container of containers) {
    summary.checked++;

    // ── Claim atômico: pending → publishing ───────────────────────────────────
    // Garante que apenas UMA invocação concorrente do cron processe cada container.
    // Duas invocações podem ler o mesmo container em "pending" na query inicial,
    // mas apenas a primeira a executar este UPDATE vence — a outra recebe 0 rows.
    // PostgreSQL garante serialização via row-level lock na instrução UPDATE.
    {
      const { data: claimed } = await (admin as any)
        .from("pending_containers")
        .update({ status: "publishing" })
        .eq("id", container.id)
        .eq("status", "pending")   // condição atômica — falha se outra invocação já reivindicou
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
      let tokenToUse = account.meta_access_token;

      if (isTokenExpiringSoon(account.token_expires_at, 7)) {
        try {
          const { token, expiresAt } = await refreshMetaToken(
            account.meta_access_token,
            account.fb_page_id
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

      const pollStatus = await pollContainerStatusOnce(container.creation_id, tokenToUse);

      if (pollStatus === "in_progress") {
        // Volta para "pending" — sem isso o container fica preso em "publishing"
        // (a query só busca "pending") e o AUTO-HEALING mata-o como "error" em 30 min.
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

      // FINISHED — delay anti-burst antes de cada publish (exceto o primeiro).
      // Aplica delay entre TODAS as tentativas de publish (sucesso ou falha),
      // pois "too many actions" acontece mesmo quando a tentativa anterior falhou.
      if (publishAttemptsInThisRun > 0) {
        await sleep(2_000);
      }
      publishAttemptsInThisRun++;

      const mediaId = await publishReadyContainer(
        container.ig_business_account_id,
        container.creation_id,
        tokenToUse
      );

      await (admin as any)
        .from("pending_containers")
        .update({ status: "published", media_id: mediaId })
        .eq("id", container.id);

      summary.published++;
      console.log(`[publish-pending] ✓ @${account.username} → media_id: ${mediaId}`);

      // Log diagnóstico: sempre mostra o estado da legenda armazenada,
      // incluindo quando está vazia (facilita identificar onde a legenda se perde).
      const captionStored = container.caption ?? "";
      console.log(
        `[publish-pending] legenda_armazenada @${account.username}: ` +
        (captionStored.trim()
          ? `${captionStored.length} char(s) — "${captionStored.slice(0, 80)}${captionStored.length > 80 ? "…" : ""}"`
          : "VAZIA — post será publicado sem legenda")
      );

      // Double-tap de legenda: 5s de delay (Reel finaliza rápido após publish).
      // 3 tentativas com 4s de intervalo — total pior caso: 5 + 3×(API+4s) ≈ 20s.
      if (captionStored.trim()) {
        await sleep(5_000);

        let captionApplied = false;
        for (let attempt = 1; attempt <= 3 && !captionApplied; attempt++) {
          try {
            await updatePostCaption(mediaId, captionStored, tokenToUse);
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
        // Erro transitório: reset publishing → pending para retry no próximo ciclo.
        // NÃO deixamos em "publishing" pois o AUTO-HEALING converteria para "error".
        await (admin as any)
          .from("pending_containers")
          .update({ status: "pending" })
          .eq("id", container.id);
        console.warn(
          `[publish-pending] Erro transitório @${account?.username ?? "?"}: resetando para pending (retry em 5 min). Motivo: "${msg}"`
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
