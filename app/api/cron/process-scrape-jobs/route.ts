/**
 * /api/cron/process-scrape-jobs
 *
 * Drena a fila `scrape_jobs` — raspagem de reels de um perfil via conta
 * LEITORA dedicada (instagrapi), complementando a Apify nas Inspirações.
 *
 * Mesmos padrões de process-instagram-logins: claim atômico, auto-healing de
 * job preso em 'processing', backoff exponencial em erro transitório, jitter
 * anti-burst por TENTATIVA. Lote pequeno + cadência conservadora (fase de
 * calibração) — a mesma conta leitora nunca dispara em rajada.
 *
 * Ao concluir, o resultado é gravado em `scraped_profiles` (a MESMA tabela que
 * a Apify usa) — assim o perfil raspado aparece no histórico e no grid das
 * Inspirações e o fluxo de "Salvar na Biblioteca" funciona sem mudança.
 */

import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { encrypt, decryptMaybe } from "@/lib/encrypt";
import { callPythonServer, hasPythonServer } from "@/lib/python-server";
import { requireCronAuth } from "@/lib/cron-auth";
import { normalizeInstagrapiReels, type RawInstagrapiReel } from "@/lib/instagrapi-reel";

export const runtime = "nodejs";
export const maxDuration = 300;

const RUN_LIMIT = 3;
const MAX_TRANSIENT_RETRIES = 6;
// maxDuration=300, mas RUN_LIMIT=3 jobs sequenciais de até 130s cada podem
// somar ~394s — corta o loop antes de estourar o timeout real da Vercel.
const RUN_BUDGET_MS = 250_000;
const STUCK_PROCESSING_MS = 10 * 60_000;
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

interface ScrapeProfileResponse {
  success: boolean;
  settings?: Record<string, unknown>;
  ig_user_id?: string | null;
  reels?: RawInstagrapiReel[] | null;
  result_count?: number | null;
  error_code?:
    | "target_not_found"
    | "target_private"
    | "session_expired"
    | "bad_password"
    | "banned_or_disabled"
    | "checkpoint_required"
    | "two_factor_required"
    | "rate_limited"
    | "network_error"
    | "app_outdated"
    | "unknown";
  error_message?: string;
}

interface JobRow {
  id: string;
  user_id: string;
  reader_account_id: string;
  target_username: string;
  limit_items: number;
  verify: boolean;
  retry_count: number;
  reader_accounts: {
    id: string;
    username: string;
    password_enc: string | null;
    totp_secret_enc: string | null;
    proxy_url: string | null;
    session_settings: string | null;
  } | null;
}

// Alvo não existe / é privado sem follow: não adianta repetir — erro permanente
// do JOB, mas a conta leitora continua saudável.
const PERMANENT_TARGET_ERRORS = new Set(["target_not_found", "target_private"]);
// Problema na própria conta leitora: marca a conta como 'error' (precisa de
// reconexão manual) e encerra o job.
// app_outdated: o Instagram recusou a versão do app do servidor Python — retry
// não resolve (precisa atualizar python_server). Encerra com erro visível em
// vez de deixar a UI "conectando…" em backoff silencioso.
const READER_DEAD_ERRORS = new Set(["bad_password", "banned_or_disabled", "checkpoint_required", "app_outdated", "two_factor_required"]);

function backoffMinutes(retryCount: number): number {
  return Math.min(10 * 2 ** retryCount, 180);
}

export async function GET(req: NextRequest) {
  const cronAuth = requireCronAuth(req);
  if (!cronAuth.ok) return cronAuth.response;

  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
    return NextResponse.json({ skipped: true, reason: "Supabase não configurado." });
  }
  if (!hasPythonServer()) {
    return NextResponse.json({ skipped: true, reason: "PYTHON_SERVER_URL não configurado." });
  }

  const admin = getSupabaseAdmin();
  const now = new Date();
  const nowIso = now.toISOString();
  const runStart = Date.now();
  const summary = { checked: 0, done: 0, transient: 0, error: 0, skipped_no_proxy: 0, auto_healed: 0 };

  // ── AUTO-HEALING: jobs presos em 'processing' (>10 min) voltam pra fila ────
  {
    const healCutoff = new Date(now.getTime() - STUCK_PROCESSING_MS).toISOString();
    const { data: healed, error: healErr } = await (admin as any)
      .from("scrape_jobs")
      .update({
        status: "queued",
        error_message: "[AUTO-HEALING] Job preso >10 min em processing — devolvido à fila.",
      })
      .eq("status", "processing")
      // Mede desde o CLAIM (retry_after é carimbado no claim), não desde a
      // criação: um job re-tentado após backoff já nasce "velho" por
      // created_at e era devolvido à fila ENQUANTO rodava — a invocação
      // seguinte (cron */5, run de até 300s) raspava de novo com a mesma
      // conta leitora, em paralelo.
      .or(`retry_after.is.null,retry_after.lt.${healCutoff}`)
      .select("id");

    if (healErr) {
      console.warn("[scrape-cron] AUTO-HEALING falhou:", healErr.message);
    } else if (healed?.length) {
      console.log(`[scrape-cron] AUTO-HEALING: destravando ${healed.length} job(s).`);
      summary.auto_healed = healed.length;
    }
  }

  const { data: rows, error: fetchErr } = await (admin as any)
    .from("scrape_jobs")
    .select(`
      id, user_id, reader_account_id, target_username, limit_items, verify, retry_count,
      reader_accounts ( id, username, password_enc, totp_secret_enc, proxy_url, session_settings )
    `)
    .eq("status", "queued")
    .or(`retry_after.is.null,retry_after.lte.${nowIso}`)
    .order("retry_after", { ascending: true, nullsFirst: true })
    .limit(RUN_LIMIT);

  if (fetchErr) {
    console.error("[scrape-cron] Erro ao buscar jobs:", fetchErr.message);
    return NextResponse.json({ error: fetchErr.message }, { status: 500 });
  }

  const jobs = (rows ?? []) as JobRow[];
  console.log(`[scrape-cron] ${jobs.length} job(s) elegível(is).`);

  let attempts = 0;

  for (const job of jobs) {
    const elapsed = Date.now() - runStart;
    if (elapsed > RUN_BUDGET_MS) {
      console.log(`[scrape-cron] ⏱ Budget esgotado (${Math.round(elapsed / 1000)}s) — resto no próximo ciclo.`);
      break;
    }

    summary.checked++;

    // Claim atômico — só uma invocação concorrente vence.
    const { data: claimed } = await (admin as any)
      .from("scrape_jobs")
      // retry_after vira o carimbo do claim: o AUTO-HEALING mede "preso" a
      // partir daqui, não de created_at.
      .update({ status: "processing", retry_after: new Date().toISOString() })
      .eq("id", job.id)
      .eq("status", "queued")
      .select("id");

    if (!claimed?.length) {
      console.log(`[scrape-cron] Job ${job.id}: já reivindicado — pulando.`);
      continue;
    }

    const reader = job.reader_accounts;
    if (!reader) {
      await (admin as any).from("scrape_jobs").update({
        status: "error",
        error_message: "Conta leitora associada não encontrada.",
        processed_at: nowIso,
      }).eq("id", job.id);
      summary.error++;
      continue;
    }

    // Regra do projeto: sem proxy dedicado, nenhuma chamada em nome da conta.
    if (!reader.proxy_url) {
      await (admin as any).from("scrape_jobs").update({
        status: "queued",
        error_message: "Aguardando proxy dedicado para a conta leitora.",
        retry_after: new Date(now.getTime() + 30 * 60_000).toISOString(),
      }).eq("id", job.id);
      summary.skipped_no_proxy++;
      continue;
    }

    // Anti-burst por TENTATIVA (não por sucesso) — igual a process-loops.
    if (attempts > 0) await sleep(Math.floor(Math.random() * 2_000) + 1_000);
    attempts++;

    try {
      const proxyUrl = decryptMaybe(reader.proxy_url)!;
      const password = decryptMaybe(reader.password_enc);
      const totpSecret = decryptMaybe(reader.totp_secret_enc);
      const existingSettings = reader.session_settings
        ? JSON.parse(decryptMaybe(reader.session_settings) ?? "null")
        : null;

      if (!password) throw new Error("Senha ausente na conta leitora.");

      const result = await callPythonServer<ScrapeProfileResponse>("/instagram/scrape-profile", {
        username: reader.username,
        password,
        proxy_url: proxyUrl,
        device_seed: reader.id,
        totp_secret: totpSecret || undefined,
        existing_settings: existingSettings || undefined,
        target_username: job.target_username,
        limit: job.limit_items,
      }, 130_000);

      if (result.success) {
        // Persiste a sessão renovada (device fingerprint + cookies) e marca a
        // conta leitora como saudável.
        const readerUpdate: Record<string, unknown> = {
          status: "online",
          last_error: null,
          last_scrape_at: new Date().toISOString(),
        };
        if (result.settings) readerUpdate.session_settings = encrypt(JSON.stringify(result.settings));
        if (result.ig_user_id) readerUpdate.ig_user_id = result.ig_user_id;
        await (admin as any).from("reader_accounts").update(readerUpdate).eq("id", reader.id);

        const reels = normalizeInstagrapiReels(result.reels ?? [], job.target_username);

        // Jobs de verificação NÃO poluem o histórico das Inspirações — só
        // estabelecem/renovam a sessão da conta leitora.
        if (!job.verify) {
          await (admin as any).from("scraped_profiles").upsert(
            {
              user_id: job.user_id,
              username: job.target_username,
              full_name: job.target_username,
              profile_pic_url: null,
              videos_data: reels,
              video_count: reels.length,
              scraped_at: new Date().toISOString(),
            },
            { onConflict: "user_id,username", ignoreDuplicates: false }
          );
        }

        await (admin as any).from("scrape_jobs").update({
          status: "done",
          result_count: reels.length,
          error_message: null,
          processed_at: new Date().toISOString(),
        }).eq("id", job.id);

        console.log(`[scrape-cron] ✅ @${job.target_username}: ${reels.length} reels via leitora @${reader.username}${job.verify ? " (verify)" : ""}.`);
        summary.done++;
        continue;
      }

      const errorCode = result.error_code ?? "unknown";
      const errorMessage = result.error_message ?? "Falha desconhecida na raspagem.";

      // Erro permanente do ALVO (não existe / privado) — job encerra, conta ok.
      if (PERMANENT_TARGET_ERRORS.has(errorCode)) {
        await (admin as any).from("scrape_jobs").update({
          status: "error",
          error_message: `[${errorCode}] ${errorMessage}`.slice(0, 500),
          processed_at: new Date().toISOString(),
        }).eq("id", job.id);
        summary.error++;
        continue;
      }

      // Problema na conta leitora — marca a conta 'error' (precisa reconectar)
      // e encerra o job.
      if (READER_DEAD_ERRORS.has(errorCode)) {
        await (admin as any).from("reader_accounts").update({
          status: "error",
          last_error: `[${errorCode}] ${errorMessage}`.slice(0, 500),
        }).eq("id", reader.id);
        await (admin as any).from("scrape_jobs").update({
          status: "error",
          error_message: `[${errorCode}] ${errorMessage}`.slice(0, 500),
          processed_at: new Date().toISOString(),
        }).eq("id", job.id);
        summary.error++;
        continue;
      }

      // Transitório (rate_limited, network_error, session_expired, unknown):
      // retry com backoff. Em session_expired, zera a sessão salva para forçar
      // login completo na próxima tentativa.
      if (errorCode === "session_expired") {
        await (admin as any).from("reader_accounts")
          .update({ session_settings: null })
          .eq("id", reader.id);
      }

      const nextRetryCount = job.retry_count + 1;
      if (nextRetryCount > MAX_TRANSIENT_RETRIES) {
        await (admin as any).from("scrape_jobs").update({
          status: "error",
          error_message: `Excedeu ${MAX_TRANSIENT_RETRIES} tentativas — última: [${errorCode}] ${errorMessage}`.slice(0, 500),
          processed_at: new Date().toISOString(),
        }).eq("id", job.id);
        summary.error++;
        continue;
      }

      await (admin as any).from("scrape_jobs").update({
        status: "queued",
        retry_count: nextRetryCount,
        retry_after: new Date(now.getTime() + backoffMinutes(nextRetryCount) * 60_000).toISOString(),
        error_message: `[${errorCode}] ${errorMessage}`.slice(0, 500),
      }).eq("id", job.id);

      console.warn(`[scrape-cron] ⏳ @${job.target_username}: ${errorCode} — retry em ${backoffMinutes(nextRetryCount)}min.`);
      summary.transient++;
    } catch (e) {
      console.error(`[scrape-cron] Erro inesperado no job ${job.id}:`, e);
      const nextRetryCount = job.retry_count + 1;
      await (admin as any).from("scrape_jobs").update({
        status: nextRetryCount > MAX_TRANSIENT_RETRIES ? "error" : "queued",
        retry_count: nextRetryCount,
        retry_after: new Date(now.getTime() + backoffMinutes(nextRetryCount) * 60_000).toISOString(),
        error_message: String(e).slice(0, 500),
      }).eq("id", job.id);
      summary.transient++;
    }
  }

  console.log("[scrape-cron] Resumo:", summary);
  return NextResponse.json({ ok: true, ...summary });
}
