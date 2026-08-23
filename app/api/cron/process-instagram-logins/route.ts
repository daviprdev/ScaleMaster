/**
 * /api/cron/process-instagram-logins
 *
 * Drena a fila `login_jobs` — login automatizado via instagrapi (substitui o
 * clique manual em contas que já existem, feito hoje com o MoreLogin).
 *
 * Lote pequeno + stagger deliberadamente conservador (fase de calibração):
 * limit(3) por run, cron a cada 10 min, backoff exponencial em erro
 * transitório. Mesmos padrões de claim atômico / anti-burst / cascade guard
 * já usados em publish-pending e process-loops, aplicados aqui a login em
 * vez de postagem.
 */

import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { encrypt, decryptMaybe } from "@/lib/encrypt";
import { callPythonServer, hasPythonServer } from "@/lib/python-server";
import { markDeadAccounts, type DeadAccountCandidate } from "@/lib/account-health";

export const runtime = "nodejs";
export const maxDuration = 300;

const RUN_LIMIT = 3;
const MAX_TRANSIENT_RETRIES = 6;
// maxDuration=300, mas RUN_LIMIT=3 jobs sequenciais de até 130s cada podem somar
// ~394s — corta o loop antes de estourar o timeout real da Vercel.
const RUN_BUDGET_MS = 250_000;
// Job travado em 'processing' (function morta no meio) nunca seria pego de novo,
// já que a busca só pega status='queued'. created_at é o único timestamp
// disponível na tabela (sem updated_at) — 10 min é bem acima do pior caso real
// (130s de chamada + jitter), então não gera falso positivo.
const STUCK_PROCESSING_MS = 10 * 60_000;
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

interface InstagramLoginResponse {
  success: boolean;
  settings?: Record<string, unknown>;
  ig_user_id?: string;
  username?: string;
  full_name?: string | null;
  profile_pic_url?: string | null;
  followers_count?: number | null;
  media_count?: number | null;
  error_code?: "bad_password" | "banned_or_disabled" | "checkpoint_required" | "rate_limited" | "network_error" | "unknown";
  error_message?: string;
}

interface JobRow {
  id: string;
  user_id: string;
  account_id: string;
  account_login_id: string;
  retry_count: number;
  instagram_accounts: {
    id: string;
    username: string;
    proxy_url: string | null;
    access_token: string | null;
  } | null;
  account_logins: {
    id: string;
    username: string;
    password_hash: string | null;
    two_factor_key: string | null;
  } | null;
}

const PERMANENT_ERROR_CODES = new Set(["bad_password", "banned_or_disabled"]);

function backoffMinutes(retryCount: number): number {
  return Math.min(10 * 2 ** retryCount, 180);
}

export async function GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization");
  if (!cronSecret) {
    console.warn("[cron] AVISO: CRON_SECRET nao configurado.");
  } else if (auth !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

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

  // ── AUTO-HEALING: Jobs presos em 'processing' (>10 min) voltam pra fila ────
  {
    const healCutoff = new Date(now.getTime() - STUCK_PROCESSING_MS).toISOString();
    const { data: healed, error: healErr } = await (admin as any)
      .from("login_jobs")
      .update({
        status: "queued",
        error_message: "[AUTO-HEALING] Job preso >10 min em processing — devolvido à fila.",
      })
      .eq("status", "processing")
      .lt("created_at", healCutoff)
      .select("id");

    if (healErr) {
      console.warn("[AUTO-HEALING] login-cron: falha ao desbloquear jobs presos:", healErr.message);
    } else {
      const healedCount = healed?.length ?? 0;
      if (healedCount > 0) {
        console.log(`[AUTO-HEALING] login-cron: destravando ${healedCount} job(s) preso(s).`);
        summary.auto_healed = healedCount;
      }
    }
  }

  const { data: rows, error: fetchErr } = await (admin as any)
    .from("login_jobs")
    .select(`
      id, user_id, account_id, account_login_id, retry_count,
      instagram_accounts ( id, username, proxy_url, access_token ),
      account_logins ( id, username, password_hash, two_factor_key )
    `)
    .eq("status", "queued")
    .or(`retry_after.is.null,retry_after.lte.${nowIso}`)
    .order("retry_after", { ascending: true, nullsFirst: true })
    .limit(RUN_LIMIT);

  if (fetchErr) {
    console.error("[login-cron] Erro ao buscar jobs:", fetchErr.message);
    return NextResponse.json({ error: fetchErr.message }, { status: 500 });
  }

  const jobs = (rows ?? []) as JobRow[];
  console.log(`[login-cron] ${jobs.length} job(s) elegível(is).`);

  const attemptedAccounts = new Set<string>();
  const deadCandidates: DeadAccountCandidate[] = [];
  let attempts = 0;

  for (const job of jobs) {
    // ── Budget global ──────────────────────────────────────────────────────
    const elapsed = Date.now() - runStart;
    if (elapsed > RUN_BUDGET_MS) {
      console.log(`[login-cron] ⏱ Budget esgotado (${Math.round(elapsed / 1000)}s) — restante fica pro próximo ciclo.`);
      break;
    }

    summary.checked++;

    // Claim atômico — mesmo idiom CAS de publish-pending.
    const { data: claimed } = await (admin as any)
      .from("login_jobs")
      .update({ status: "processing" })
      .eq("id", job.id)
      .eq("status", "queued")
      .select("id");

    if (!claimed?.length) {
      console.log(`[login-cron] Job ${job.id}: já reivindicado por invocação concorrente — pulando.`);
      continue;
    }

    const account = job.instagram_accounts;
    const login = job.account_logins;

    if (!account || !login) {
      await (admin as any).from("login_jobs").update({
        status: "error",
        error_message: "Conta ou credencial associada não encontrada.",
        processed_at: nowIso,
      }).eq("id", job.id);
      summary.error++;
      continue;
    }

    // Regra do projeto: sem proxy dedicado, nenhuma chamada em nome da conta.
    if (!account.proxy_url) {
      await (admin as any).from("login_jobs").update({
        status: "queued",
        error_message: "Aguardando proxy dedicado no estoque.",
        retry_after: new Date(now.getTime() + 30 * 60_000).toISOString(),
      }).eq("id", job.id);
      summary.skipped_no_proxy++;
      continue;
    }

    attemptedAccounts.add(account.id);

    // Anti-burst — mesmo padrão de process-loops: pausa por TENTATIVA, não por
    // sucesso, pra nunca disparar em rajada mesmo se tudo falhar em sequência.
    if (attempts > 0) await sleep(Math.floor(Math.random() * 2_000) + 1_000);
    attempts++;

    try {
      const proxyUrl = decryptMaybe(account.proxy_url)!;
      const password = decryptMaybe(login.password_hash);
      const totpSecret = decryptMaybe(login.two_factor_key);
      const existingSettings = account.access_token
        ? JSON.parse(decryptMaybe(account.access_token) ?? "null")
        : null;

      if (!password) {
        throw new Error("Senha ausente no Logins Vault.");
      }

      const result = await callPythonServer<InstagramLoginResponse>("/instagram/login", {
        username: login.username,
        password,
        proxy_url: proxyUrl,
        device_seed: account.id,
        totp_secret: totpSecret || undefined,
        existing_settings: existingSettings || undefined,
      }, 130_000);

      if (result.success) {
        await (admin as any).from("instagram_accounts").update({
          display_name: result.full_name ?? undefined,
          avatar_url: result.profile_pic_url ?? undefined,
          followers_count: result.followers_count ?? undefined,
          posts_count: result.media_count ?? undefined,
          access_token: encrypt(JSON.stringify(result.settings ?? {})),
          health_status: "online",
        }).eq("id", account.id);

        await (admin as any).from("login_jobs").update({
          status: "done",
          processed_at: new Date().toISOString(),
        }).eq("id", job.id);

        console.log(`[login-cron] ✅ @${login.username} conectada via instagrapi.`);
        summary.done++;
        continue;
      }

      const errorCode = result.error_code ?? "unknown";
      const errorMessage = result.error_message ?? "Falha desconhecida no login.";

      if (PERMANENT_ERROR_CODES.has(errorCode)) {
        await (admin as any).from("login_jobs").update({
          status: "error",
          error_message: `[${errorCode}] ${errorMessage}`.slice(0, 500),
          processed_at: new Date().toISOString(),
        }).eq("id", job.id);

        deadCandidates.push({
          accountId: account.id,
          username: login.username,
          userId: job.user_id,
          reason: `[login-cron:${errorCode}] ${errorMessage}`,
        });
        summary.error++;
        continue;
      }

      // Transitório — checkpoint_required (inesperado, já que a conta só usa
      // TOTP), rate_limited, network_error, unknown: retry com backoff.
      const nextRetryCount = job.retry_count + 1;
      if (nextRetryCount > MAX_TRANSIENT_RETRIES) {
        await (admin as any).from("login_jobs").update({
          status: "error",
          error_message: `Excedeu ${MAX_TRANSIENT_RETRIES} tentativas — última: [${errorCode}] ${errorMessage}`.slice(0, 500),
          processed_at: new Date().toISOString(),
        }).eq("id", job.id);
        summary.error++;
        continue;
      }

      await (admin as any).from("login_jobs").update({
        status: "queued",
        retry_count: nextRetryCount,
        retry_after: new Date(now.getTime() + backoffMinutes(nextRetryCount) * 60_000).toISOString(),
        error_message: `[${errorCode}] ${errorMessage}`.slice(0, 500),
      }).eq("id", job.id);

      console.warn(`[login-cron] ⏳ @${login.username}: ${errorCode} — retry em ${backoffMinutes(nextRetryCount)}min.`);
      summary.transient++;
    } catch (e) {
      console.error(`[login-cron] Erro inesperado em @${login.username}:`, e);
      const nextRetryCount = job.retry_count + 1;
      await (admin as any).from("login_jobs").update({
        status: nextRetryCount > MAX_TRANSIENT_RETRIES ? "error" : "queued",
        retry_count: nextRetryCount,
        retry_after: new Date(now.getTime() + backoffMinutes(nextRetryCount) * 60_000).toISOString(),
        error_message: String(e).slice(0, 500),
      }).eq("id", job.id);
      summary.transient++;
    }
  }

  await markDeadAccounts(admin, "login-cron", deadCandidates, attemptedAccounts.size);

  console.log("[login-cron] Resumo:", summary);
  return NextResponse.json({ ok: true, ...summary });
}
