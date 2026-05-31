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

  // ── AUTO-HEALING: Containers expirados (>30 min em pending) ──────────────
  // Executa antes do loop principal para garantir que a query de busca retorne
  // apenas containers legítimos ainda dentro do SLA de processamento da Meta.
  {
    const healCutoff = new Date(now.getTime() - CONTAINER_TTL_MS).toISOString();
    const { data: healed, error: healErr } = await (admin as any)
      .from("pending_containers")
      .update({
        status: "error",
        error_message: "[AUTO-HEALING] Expirado: container preso em 'pending' por >30 minutos — desbloqueado pelo publish-pending.",
      })
      .eq("status", "pending")
      .lt("created_at", healCutoff)
      .select("id");

    if (healErr) {
      console.warn("[AUTO-HEALING] publish-pending: falha ao desbloquear containers:", healErr.message);
    } else {
      const healedCount = healed?.length ?? 0;
      if (healedCount > 0) {
        console.log(
          `[AUTO-HEALING] Destravando ${healedCount} container(s) que ficaram presos em processamento.`
        );
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
    .limit(50);

  if (fetchErr) {
    console.error("[publish-pending] Erro ao buscar containers:", fetchErr.message);
    return NextResponse.json({ error: fetchErr.message }, { status: 500 });
  }

  const containers = (rows ?? []) as PendingContainerRow[];
  console.log(`[publish-pending] ${containers.length} container(s) pendente(s).`);

  // Conta publishes neste ciclo para inserir delay anti-rate-limit entre cada chamada
  // a media_publish. A Meta API bloqueia com "too many actions" quando múltiplas
  // publicações chegam em burst (>~12/min por app). 2s de espaçamento resolve.
  let publishedInThisRun = 0;

  for (const container of containers) {
    summary.checked++;

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
      // Espaça as chamadas a media_publish em 2s para evitar "too many actions".
      if (publishedInThisRun > 0) {
        await sleep(2_000);
      }

      const mediaId = await publishReadyContainer(
        container.ig_business_account_id,
        container.creation_id,
        tokenToUse
      );

      await (admin as any)
        .from("pending_containers")
        .update({ status: "published", media_id: mediaId })
        .eq("id", container.id);

      publishedInThisRun++;
      summary.published++;
      console.log(`[publish-pending] ✓ @${account.username} → media_id: ${mediaId}`);

      // Reparo pós-publicação: a Meta API descarta legendas silenciosamente de forma
      // intermitente durante o processamento do container. Este POST restaura a legenda
      // no post já publicado para garantir 100% de cobertura.
      if (container.caption) {
        // [RAIO-X] — snapshot da caption armazenada no container antes do double-tap
        console.log(
          `[RAIO-X] double-tap | @${account.username} | mediaId=${mediaId} | ` +
          `caption_stored_chars=${container.caption.length} | ` +
          `caption_ok=${container.caption.trim().length > 0 ? "SIM" : "VAZIA!!!"} | ` +
          `preview="${container.caption.slice(0, 80)}${container.caption.length > 80 ? "…" : ""}"`
        );
        try {
          await updatePostCaption(mediaId, container.caption, tokenToUse);
          console.log(`[publish-pending] ✓ Caption aplicada @${account.username}`);
        } catch (captionErr) {
          const captMsg = captionErr instanceof Error ? captionErr.message : String(captionErr);
          console.warn(`[publish-pending] Caption update falhou @${account.username}: ${captMsg}`);
          // Não falha o publish — o reel foi publicado, apenas a legenda pode estar ausente
        }
      }

    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[publish-pending] ✗ container ${container.id}:`, msg);
      summary.errors++;

      if (isRetryableMetaError(msg)) {
        // Erro transitório: mantém como "pending" para retry automático no próximo
        // ciclo do cron (5 min). O AUTO-HEALING de 30 min garante que não fique
        // preso indefinidamente caso o erro persista.
        console.warn(
          `[publish-pending] Erro transitório @${account?.username ?? "?"}: mantendo pending para retry. Motivo: "${msg}"`
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
