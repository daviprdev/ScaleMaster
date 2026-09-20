/**
 * /api/cron/process-onboarding-jobs
 *
 * Drena a fila `onboarding_jobs` (Fase Onboarding 1/3). Cada job percorre, UMA
 * etapa por ciclo e SEMPRE em sequencia:
 *
 *   invite -> photo -> professional -> verify_professional -> magic_link -> done
 *
 * Esqueleto copiado de process-scrape-jobs: claim atomico, auto-healing de job
 * preso em 'processing', backoff exponencial, jitter anti-burst por TENTATIVA.
 *
 * Regras:
 *  - Sem proxy decifravel = o job pula o ciclo, sem chamada nenhuma e sem
 *    fallback para o IP da Vercel.
 *  - Falha de etapa: retry com backoff; 3 falhas na MESMA etapa = job 'error'
 *    permanente com motivo legivel em stage_status.
 *  - Conta morta (senha errada, checkpoint, suspensa, app desatualizado) ou
 *    etapa que exige humano (needs_manual) = 'error' imediato.
 *  - verify_professional: polling do account_type a cada ciclo, ate 1h.
 *  - magic_link: nesta fase o cron so DETECTA a conta conectada em
 *    instagram_accounts (a visita automatica ao link fica para a fase 2/3).
 */

import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { encrypt, decryptMaybe } from "@/lib/encrypt";
import { callPythonServer, hasPythonServer } from "@/lib/python-server";
import { requireCronAuth } from "@/lib/cron-auth";
import {
  isOnboardingStage,
  nextStage,
  withStage,
  type OnboardingStage,
  type StageStatusMap,
} from "@/lib/onboarding";

export const runtime = "nodejs";
export const maxDuration = 300;

const RUN_LIMIT = 4;
const RUN_BUDGET_MS = 250_000;
const STUCK_PROCESSING_MS = 10 * 60_000;
const MAX_STAGE_FAILURES = 3;
const VERIFY_PROFESSIONAL_MAX_MS = 60 * 60_000;
const VERIFY_POLL_INTERVAL_MS = 2 * 60_000;
const MAGIC_LINK_POLL_INTERVAL_MS = 5 * 60_000;
const MAGIC_LINK_MAX_WAIT_MS = 72 * 60 * 60_000;
const NO_PROXY_RETRY_MS = 15 * 60_000;
const PYTHON_TIMEOUT_MS = 130_000;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

interface OnboardingPythonResponse {
  success: boolean;
  session_settings?: Record<string, unknown> | null;
  ig_user_id?: string | null;
  account_type?: string | null;
  is_professional?: boolean | null;
  accepted?: string[] | null;
  pending_found?: number | null;
  error_code?: string | null;
  error_message?: string | null;
}

interface JobRow {
  id: string;
  user_id: string;
  username: string;
  stage: string;
  stage_status: StageStatusMap | null;
  password_enc: string;
  two_factor_enc: string | null;
  proxy_url_enc: string | null;
  session_settings: string | null;
  photo_url: string | null;
  magic_link: string | null;
  retry_count: number;
  created_at: string;
}

// Conta com problema que retry nao resolve.
const ACCOUNT_DEAD_ERRORS = new Set(["bad_password", "banned_or_disabled", "checkpoint_required", "app_outdated"]);
// Etapa que precisa de acao humana (ou dado corrigido) antes de continuar.
const NEEDS_MANUAL_ERRORS = new Set(["needs_manual", "invalid_photo", "two_factor_required"]);

const STAGE_ENDPOINT: Record<Exclude<OnboardingStage, "magic_link">, string> = {
  invite: "/onboarding/accept-invite",
  photo: "/onboarding/change-photo",
  professional: "/onboarding/switch-professional",
  verify_professional: "/onboarding/check-professional",
};

function backoffMinutes(failures: number): number {
  return Math.min(5 * 2 ** failures, 60);
}

/** Pausa curta entre etapas do mesmo job - nada de rajada de acoes na conta. */
function interStageDelayMs(): number {
  return 30_000 + Math.floor(Math.random() * 60_000);
}

export async function GET(req: NextRequest) {
  const cronAuth = requireCronAuth(req);
  if (!cronAuth.ok) return cronAuth.response;

  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
    return NextResponse.json({ skipped: true, reason: "Supabase nao configurado." });
  }
  if (!hasPythonServer()) {
    return NextResponse.json({ skipped: true, reason: "PYTHON_SERVER_URL nao configurado." });
  }

  const admin = getSupabaseAdmin();
  const runStart = Date.now();
  const summary = {
    checked: 0,
    advanced: 0,
    done: 0,
    waiting: 0,
    transient: 0,
    error: 0,
    skipped_no_proxy: 0,
    auto_healed: 0,
  };

  // AUTO-HEALING: job preso em 'processing' (>10 min desde o CLAIM) volta pra fila.
  {
    const healCutoff = new Date(Date.now() - STUCK_PROCESSING_MS).toISOString();
    const { data: healed, error: healErr } = await (admin as any)
      .from("onboarding_jobs")
      .update({
        status: "pending",
        error_message: "[AUTO-HEALING] Job preso >10 min em processing - devolvido a fila.",
      })
      .eq("status", "processing")
      .or(`retry_after.is.null,retry_after.lt.${healCutoff}`)
      .select("id");

    if (healErr) {
      console.warn("[onboarding-cron] AUTO-HEALING falhou:", healErr.message);
    } else if (healed?.length) {
      console.log(`[onboarding-cron] AUTO-HEALING: destravando ${healed.length} job(s).`);
      summary.auto_healed = healed.length;
    }
  }

  const nowIso = new Date().toISOString();
  const { data: rows, error: fetchErr } = await (admin as any)
    .from("onboarding_jobs")
    .select(
      "id, user_id, username, stage, stage_status, password_enc, two_factor_enc, proxy_url_enc, session_settings, photo_url, magic_link, retry_count, created_at"
    )
    .eq("status", "pending")
    .or(`retry_after.is.null,retry_after.lte.${nowIso}`)
    .order("retry_after", { ascending: true, nullsFirst: true })
    .limit(RUN_LIMIT);

  if (fetchErr) {
    console.error("[onboarding-cron] Erro ao buscar jobs:", fetchErr.message);
    return NextResponse.json({ error: fetchErr.message }, { status: 500 });
  }

  const jobs = (rows ?? []) as JobRow[];
  console.log(`[onboarding-cron] ${jobs.length} job(s) elegivel(is).`);

  let attempts = 0;

  for (const job of jobs) {
    const elapsed = Date.now() - runStart;
    if (elapsed > RUN_BUDGET_MS) {
      console.log(`[onboarding-cron] Budget esgotado (${Math.round(elapsed / 1000)}s) - resto no proximo ciclo.`);
      break;
    }

    summary.checked++;

    // Claim atomico - retry_after vira o carimbo do claim (auto-healing mede daqui).
    const { data: claimed } = await (admin as any)
      .from("onboarding_jobs")
      .update({ status: "processing", retry_after: new Date().toISOString() })
      .eq("id", job.id)
      .eq("status", "pending")
      .select("id");

    if (!claimed?.length) {
      console.log(`[onboarding-cron] Job ${job.id}: ja reivindicado - pulando.`);
      continue;
    }

    const update = (patch: Record<string, unknown>) =>
      (admin as any).from("onboarding_jobs").update(patch).eq("id", job.id);

    if (!isOnboardingStage(job.stage)) {
      await update({
        status: "error",
        error_message: `Etapa desconhecida: ${job.stage}`,
        processed_at: new Date().toISOString(),
      });
      summary.error++;
      continue;
    }

    const stage = job.stage;
    const stageStatus = job.stage_status ?? {};

    /** Etapa concluida: avanca (ou encerra o job) e zera o contador de falhas. */
    const advance = async (reason: string | null, extra: Record<string, unknown> = {}) => {
      let map = withStage(stageStatus, stage, { state: "ok", reason, ...extra });
      const next = nextStage(stage);
      if (!next) {
        await update({
          status: "done",
          stage_status: map,
          retry_count: 0,
          retry_after: null,
          error_message: null,
          processed_at: new Date().toISOString(),
        });
        summary.done++;
        return;
      }
      map = withStage(map, next, { state: "pending", started_at: new Date().toISOString() });
      await update({
        status: "pending",
        stage: next,
        stage_status: map,
        retry_count: 0,
        retry_after: new Date(Date.now() + interStageDelayMs()).toISOString(),
        error_message: null,
      });
      summary.advanced++;
    };

    /** Encerra o job como erro permanente com motivo legivel na etapa. */
    const failPermanently = async (state: "error" | "needs_manual", reason: string) => {
      await update({
        status: "error",
        stage_status: withStage(stageStatus, stage, { state, reason: reason.slice(0, 500) }),
        error_message: `[${stage}] ${reason}`.slice(0, 500),
        processed_at: new Date().toISOString(),
      });
      summary.error++;
    };

    /** Mantem o job na mesma etapa, esperando, sem contar como falha. */
    const waitSameStage = async (delayMs: number, reason: string) => {
      await update({
        status: "pending",
        stage_status: withStage(stageStatus, stage, { state: "pending", reason }),
        retry_after: new Date(Date.now() + delayMs).toISOString(),
      });
      summary.waiting++;
    };

    /** Falha contavel: backoff; a 3a falha na etapa encerra o job. */
    const failCounted = async (reason: string) => {
      const failures = job.retry_count + 1;
      if (failures >= MAX_STAGE_FAILURES) {
        await failPermanently("error", `${MAX_STAGE_FAILURES} falhas nesta etapa - ultima: ${reason}`);
        return;
      }
      await update({
        status: "pending",
        retry_count: failures,
        retry_after: new Date(Date.now() + backoffMinutes(failures) * 60_000).toISOString(),
        stage_status: withStage(stageStatus, stage, {
          state: "pending",
          reason: `Falha ${failures}/${MAX_STAGE_FAILURES}: ${reason}`.slice(0, 500),
        }),
        error_message: `[${stage}] ${reason}`.slice(0, 500),
      });
      summary.transient++;
    };

    try {
      // magic_link: nenhuma chamada em nome da conta nesta fase - so detecta a
      // conexao em instagram_accounts.
      if (stage === "magic_link") {
        const { data: connected } = await (admin as any)
          .from("instagram_accounts")
          .select("id, ig_user_id")
          .eq("user_id", job.user_id)
          // "_" e curinga no ILIKE - escapado para casar o username literal.
          .ilike("username", job.username.replace(/[\\%_]/g, (c) => `\\${c}`))
          .limit(1)
          .maybeSingle();

        if (connected?.id) {
          await update({ account_id: connected.id });
          await advance("Conta conectada no SaaS.");
          console.log(`[onboarding-cron] @${job.username}: conectada (account ${connected.id}).`);
          continue;
        }

        const startedAt = Date.parse(stageStatus.magic_link?.started_at ?? job.created_at);
        if (Date.now() - startedAt > MAGIC_LINK_MAX_WAIT_MS) {
          await failPermanently("needs_manual", "Conta nao conectou em 72h - visite o link magico manualmente.");
          continue;
        }
        await waitSameStage(
          MAGIC_LINK_POLL_INTERVAL_MS,
          job.magic_link
            ? "Aguardando visita ao link magico (automacao na fase 2/3)."
            : "Aguardando conexao - nenhum link magico cadastrado."
        );
        continue;
      }

      // photo sem foto cadastrada: etapa opcional, pula sem chamada.
      if (stage === "photo" && !job.photo_url) {
        await advance("Sem photo_url - etapa pulada.");
        continue;
      }

      // Regra do projeto: sem proxy decifravel, nenhuma chamada em nome da conta.
      const proxyUrl = job.proxy_url_enc ? decryptMaybe(job.proxy_url_enc) : null;
      if (!proxyUrl || !/^(https?|socks5h?):\/\//i.test(proxyUrl)) {
        await update({
          status: "pending",
          retry_after: new Date(Date.now() + NO_PROXY_RETRY_MS).toISOString(),
          error_message: "Aguardando proxy dedicado valido - nenhuma chamada feita.",
        });
        summary.skipped_no_proxy++;
        continue;
      }

      const password = decryptMaybe(job.password_enc);
      if (!password) {
        await failPermanently("needs_manual", "Senha ausente - edite o job.");
        continue;
      }
      const twoFactor = job.two_factor_enc ? decryptMaybe(job.two_factor_enc) : null;

      let sessionSettings: Record<string, unknown> | null = null;
      if (job.session_settings) {
        try {
          sessionSettings = JSON.parse(decryptMaybe(job.session_settings) ?? "null");
        } catch {
          sessionSettings = null; // sessao corrompida: login completo
        }
      }

      if (attempts > 0) await sleep(Math.floor(Math.random() * 2_000) + 1_000);
      attempts++;

      const body: Record<string, unknown> = {
        username: job.username,
        password,
        proxy_url: proxyUrl,
        device_seed: job.id,
        totp_secret: twoFactor || undefined,
        session_settings: sessionSettings || undefined,
      };
      if (stage === "photo") body.photo_url = job.photo_url;

      const result = await callPythonServer<OnboardingPythonResponse>(
        STAGE_ENDPOINT[stage],
        body,
        PYTHON_TIMEOUT_MS
      );

      // Sessao renovada e persistida sempre que vier - sucesso ou falha.
      const sessionPatch: Record<string, unknown> = {};
      if (result.session_settings) sessionPatch.session_settings = encrypt(JSON.stringify(result.session_settings));
      if (result.ig_user_id) sessionPatch.ig_user_id = result.ig_user_id;
      if (Object.keys(sessionPatch).length) await update(sessionPatch);

      if (!result.success) {
        const code = result.error_code ?? "unknown";
        let message = `[${code}] ${result.error_message ?? "Falha desconhecida."}`;

        // A conta pede 2FA: o motivo cru da instagrapi nao diz ao usuario o que
        // fazer. Aponta o dado que falta (ou que esta errado) na propria conta.
        if (code === "two_factor_required") {
          message = twoFactor
            ? `[${code}] A conta pediu 2FA e o codigo gerado foi recusado — confira o segredo TOTP cadastrado (deve ser a chave da configuracao do autenticador, nao o codigo de 6 digitos). Detalhe: ${result.error_message ?? "sem detalhe"}`
            : `[${code}] A conta tem 2FA ativo e nenhum segredo TOTP foi cadastrado. Informe o segredo do autenticador nesta conta e tente de novo. Detalhe: ${result.error_message ?? "sem detalhe"}`;
        }
        console.warn(`[onboarding-cron] @${job.username} ${stage}: ${code}`);

        if (ACCOUNT_DEAD_ERRORS.has(code)) {
          await failPermanently("error", message);
        } else if (NEEDS_MANUAL_ERRORS.has(code)) {
          await failPermanently("needs_manual", message);
        } else {
          await failCounted(message);
        }
        continue;
      }

      switch (stage) {
        case "invite": {
          const accepted = result.accepted ?? [];
          await advance(
            accepted.length
              ? `Convite(s) aceito(s): ${accepted.join(", ")}.`
              : "Nenhum convite pendente encontrado (ja aceito ou ainda nao enviado)."
          );
          break;
        }
        case "photo":
          await advance("Foto de perfil trocada.");
          break;
        case "professional":
          if (!result.is_professional) {
            // A conversao pode propagar com atraso - o verify faz o polling.
            await advance("Conversao enviada; tipo ainda nao refletido.", { account_type: result.account_type ?? null });
          } else {
            await advance(`Conta profissional (${result.account_type}).`, { account_type: result.account_type ?? null });
          }
          break;
        case "verify_professional": {
          const accountType = (result.account_type ?? "").toUpperCase();
          if (accountType === "BUSINESS" || accountType === "CREATOR") {
            await advance(`Confirmado: ${accountType}.`, { account_type: accountType });
            break;
          }
          const startedAt = Date.parse(stageStatus.verify_professional?.started_at ?? new Date().toISOString());
          if (Date.now() - startedAt > VERIFY_PROFESSIONAL_MAX_MS) {
            await failPermanently(
              "error",
              `Tipo de conta nao virou BUSINESS/CREATOR em 1h (atual: ${accountType || "desconhecido"}). Refaca a etapa professional.`
            );
            break;
          }
          await waitSameStage(
            VERIFY_POLL_INTERVAL_MS,
            `Aguardando propagacao do tipo de conta (atual: ${accountType || "desconhecido"}).`
          );
          break;
        }
      }
    } catch (e) {
      console.error(`[onboarding-cron] Erro inesperado no job ${job.id}:`, e);
      await failCounted(String(e).slice(0, 300));
    }
  }

  console.log("[onboarding-cron] Resumo:", summary);
  return NextResponse.json({ ok: true, ...summary });
}
