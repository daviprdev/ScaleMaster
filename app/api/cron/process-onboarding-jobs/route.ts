/**
 * /api/cron/process-onboarding-jobs
 *
 * Drena a fila `onboarding_jobs` usando RPA via navegador real (Playwright).
 * Cada job chama UMA ÚNICA VEZ o endpoint /onboarding-rpa/run que executa
 * todo o fluxo automaticamente:
 *   login → aceitar convite → trocar foto → postar story → criar destaque
 *
 * SEM Magic Link, SEM instagrapi, SEM etapas fragmentadas.
 * O Python server faz retry interno com troca de proxy (até 6x) se der erro de IP.
 */

import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { decryptMaybe } from "@/lib/encrypt";
import { callPythonServer, hasPythonServer } from "@/lib/python-server";
import { requireCronAuth } from "@/lib/cron-auth";

export const runtime = "nodejs";
export const maxDuration = 300;

const RUN_LIMIT = 2; // Menos jobs por ciclo porque RPA é pesado
const RUN_BUDGET_MS = 280_000;
const STUCK_PROCESSING_MS = 15 * 60_000; // RPA pode demorar mais
const PYTHON_TIMEOUT_MS = 180_000; // 3 minutos para o fluxo completo
const NO_PROXY_RETRY_MS = 15 * 60_000;

const PROXY_URL_RE = /^(https?|socks5h?):\/\//i;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

interface RPAResponse {
  success: boolean;
  stage: string;
  message: string;
  cookies?: Array<Record<string, unknown>> | null;
  error_code?: string | null;
}

interface JobRow {
  id: string;
  user_id: string;
  username: string;
  stage: string;
  stage_status: Record<string, unknown> | null;
  password_enc: string;
  two_factor_enc: string | null;
  proxy_url_enc: string | null;
  session_settings: string | null;
  photo_url: string | null;
  magic_link: string | null;
  story_media_url: string | null;
  story_link_url: string | null;
  highlight_title: string | null;
  story_pk: string | null;
  retry_count: number;
  created_at: string;
  template_id: string | null;
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
    done: 0,
    error: 0,
    skipped_no_proxy: 0,
    auto_healed: 0,
  };

  // AUTO-HEALING: job preso em 'processing' (>15 min) volta pra fila.
  {
    const healCutoff = new Date(Date.now() - STUCK_PROCESSING_MS).toISOString();
    const { data: healed, error: healErr } = await (admin as any)
      .from("onboarding_jobs")
      .update({
        status: "pending",
        error_message: "[AUTO-HEALING] Job preso >15 min em processing - devolvido a fila.",
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
      "id, user_id, username, stage, stage_status, password_enc, two_factor_enc, proxy_url_enc, session_settings, photo_url, magic_link, story_media_url, story_link_url, highlight_title, story_pk, retry_count, created_at, template_id"
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
  console.log(`[onboarding-cron] ${jobs.length} job(s) elegivel(is) para RPA.`);

  for (const job of jobs) {
    const elapsed = Date.now() - runStart;
    if (elapsed > RUN_BUDGET_MS) {
      console.log(`[onboarding-cron] Budget esgotado (${Math.round(elapsed / 1000)}s) - resto no proximo ciclo.`);
      break;
    }

    summary.checked++;

    // Claim atomico
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

    try {
      // Decifra credenciais
      const password = decryptMaybe(job.password_enc);
      const totpSecret = job.two_factor_enc ? decryptMaybe(job.two_factor_enc) : null;
      const proxyUrl = job.proxy_url_enc ? decryptMaybe(job.proxy_url_enc) : null;

      if (!password) {
        await update({
          status: "error",
          error_message: "Senha não pôde ser decifrada.",
          processed_at: new Date().toISOString(),
        });
        summary.error++;
        continue;
      }

      if (!proxyUrl || !PROXY_URL_RE.test(proxyUrl)) {
        await update({
          status: "pending",
          retry_after: new Date(Date.now() + NO_PROXY_RETRY_MS).toISOString(),
          error_message: "Aguardando proxy dedicado válido - nenhuma chamada feita.",
        });
        summary.skipped_no_proxy++;
        continue;
      }

      // Busca dados do template (app_id, photo, story, highlight)
      let appId: string | null = null;
      let photoPath: string | null = null;
      let storyMediaPath: string | null = null;
      let storyLinkUrl: string | null = null;
      let highlightTitle: string | null = null;

      if (job.template_id) {
        const { data: template } = await (admin as any)
          .from("onboarding_templates")
          .select("app_id, photo_url, story_media_url, story_link_url, highlight_title")
          .eq("id", job.template_id)
          .maybeSingle();

        if (template) {
          appId = template.app_id;
          photoPath = template.photo_url;
          storyMediaPath = template.story_media_url;
          storyLinkUrl = template.story_link_url;
          highlightTitle = template.highlight_title;
        }
      }

      // Fallback para campos do job (se não vieram do template)
      if (!appId && job.magic_link) {
        // Extrai app_id do magic_link se existir (formato antigo)
        appId = null; // Não usamos mais magic_link
      }
      if (!photoPath) photoPath = job.photo_url;
      if (!storyMediaPath) storyMediaPath = job.story_media_url;
      if (!storyLinkUrl) storyLinkUrl = job.story_link_url;
      if (!highlightTitle) highlightTitle = job.highlight_title;

      // Busca ig_app_id do app Meta (necessário para aceitar convite)
      let igAppId: string | null = null;
      if (appId) {
        const { data: appRow } = await (admin as any)
          .from("user_meta_apps")
          .select("ig_app_id")
          .eq("id", appId)
          .maybeSingle();
        igAppId = appRow?.ig_app_id ?? null;
      }

      if (!igAppId) {
        await update({
          status: "error",
          error_message: "App Meta não configurado ou ig_app_id não encontrado. Configure um template com App Meta válido.",
          processed_at: new Date().toISOString(),
        });
        summary.error++;
        continue;
      }

      // Baixa arquivos de mídia (foto e story) para paths locais no Python server
      // O Python server vai baixar via HTTP quando receber as URLs
      console.log(`[onboarding-cron] @${job.username}: iniciando RPA via navegador real...`);

      const rpaResult = await callPythonServer<RPAResponse>(
        "/onboarding-rpa/run",
        {
          username: job.username,
          password,
          proxy_url: proxyUrl,
          totp_secret: totpSecret,
          app_id: igAppId,
          photo_path: photoPath, // URL pública, Python baixa
          story_media_path: storyMediaPath, // URL pública, Python baixa
          story_link_url: storyLinkUrl,
          highlight_title: highlightTitle,
          existing_cookies: null, // TODO: carregar cookies salvos se existirem
        },
        PYTHON_TIMEOUT_MS
      );

      if (rpaResult.success) {
        // Sucesso! Marca como done e salva cookies se retornou
        const patch: Record<string, unknown> = {
          status: "done",
          stage: "done",
          stage_status: { rpa: { state: "ok", reason: rpaResult.message } },
          retry_count: 0,
          retry_after: null,
          error_message: null,
          processed_at: new Date().toISOString(),
        };

        // Salva cookies se o RPA retornou (para reuso futuro)
        if (rpaResult.cookies && rpaResult.cookies.length > 0) {
          // TODO: salvar cookies em uma coluna nova ou no session_settings
          console.log(`[onboarding-cron] @${job.username}: ${rpaResult.cookies.length} cookies salvos.`);
        }

        await update(patch);
        summary.done++;
        console.log(`[onboarding-cron] @${job.username}: RPA concluído com sucesso!`);
      } else {
        // Falha no RPA
        const errorCode = rpaResult.error_code ?? "unknown_error";
        const isPermanent = ["needs_2fa", "challenge_required", "login_failed", "file_input_not_found"].includes(errorCode);

        if (isPermanent) {
          await update({
            status: "error",
            stage_status: { rpa: { state: "error", reason: rpaResult.message } },
            error_message: `[RPA] ${rpaResult.message}`,
            processed_at: new Date().toISOString(),
          });
          summary.error++;
          console.log(`[onboarding-cron] @${job.username}: RPA falhou permanentemente - ${rpaResult.message}`);
        } else {
          // Erro transitório (timeout, IP bloqueado, etc) - retry com backoff
          const failures = job.retry_count + 1;
          const maxRetries = 6; // Como o parceiro faz: até 6 tentativas

          if (failures >= maxRetries) {
            await update({
              status: "error",
              stage_status: { rpa: { state: "error", reason: `${maxRetries} tentativas falharam - última: ${rpaResult.message}` } },
              error_message: `[RPA] ${maxRetries} tentativas falharam - última: ${rpaResult.message}`,
              processed_at: new Date().toISOString(),
            });
            summary.error++;
            console.log(`[onboarding-cron] @${job.username}: RPA falhou após ${maxRetries} tentativas.`);
          } else {
            const backoffMs = Math.min(5 * 2 ** failures, 60) * 60_000;
            await update({
              status: "pending",
              retry_count: failures,
              retry_after: new Date(Date.now() + backoffMs).toISOString(),
              stage_status: { rpa: { state: "pending", reason: `Tentativa ${failures}/${maxRetries}: ${rpaResult.message}` } },
              error_message: `[RPA] Tentativa ${failures}/${maxRetries}: ${rpaResult.message}`,
            });
            console.log(`[onboarding-cron] @${job.username}: RPA falhou (tentativa ${failures}/${maxRetries}) - retry em ${Math.round(backoffMs / 60_000)} min.`);
          }
        }
      }
    } catch (e) {
      const errorMsg = e instanceof Error ? e.message : "Erro desconhecido";
      console.error(`[onboarding-cron] @${job.username}: exceção - ${errorMsg}`);

      const failures = job.retry_count + 1;
      if (failures >= 3) {
        await update({
          status: "error",
          error_message: `[EXCEPTION] ${errorMsg}`,
          processed_at: new Date().toISOString(),
        });
        summary.error++;
      } else {
        await update({
          status: "pending",
          retry_count: failures,
          retry_after: new Date(Date.now() + 5 * 60_000).toISOString(),
          error_message: `[EXCEPTION] Tentativa ${failures}/3: ${errorMsg}`,
        });
      }
    }

    // Pausa curta entre jobs para não sobrecarregar o Python server
    await sleep(5_000);
  }

  console.log(`[onboarding-cron] Resumo:`, summary);
  return NextResponse.json(summary);
}