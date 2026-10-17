/**
 * /api/cron/sync-account-views
 *
 * Mantém `account_views_daily` com as views REAIS de cada conta (insight de
 * conta da Meta, por dia UTC) — é essa tabela que alimenta o card "Views
 * Totais" da Dashboard. Somar só os posts registrados pelo SaaS subestimava o
 * total em ordens de grandeza (a conta tem posts que o SaaS não conhece).
 *
 * Por conta, a cada run:
 *   - 1ª vez: backfill de 90 dias (blocos de 30; só detalha dia a dia os blocos
 *     com views) → marca views_backfilled_at.
 *   - Sempre: relê os últimos 3 dias UTC — a Meta consolida o dia com atraso,
 *     então hoje/ontem mudam por até ~48h.
 *
 * No mesmo run grava `account_reels_daily` (card "Vídeos Publicados"): reels
 * por dia BRT lidos da lista de mídias da conta. 1ª vez o histórico inteiro
 * (→ reels_backfilled_at); depois relê os últimos 3 dias BRT.
 *
 * Contas com health_status='error' ou sem token são puladas. Contas
 * desativadas (is_active=false, o padrão de conta nova) entram: o cron de
 * publicação posta nelas, então views e reels delas são reais. Rate limit da
 * Meta pula a conta sem avançar views_synced_at (volta no próximo run).
 * Conexão direta com a Meta (sem proxy).
 */

import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { requireCronAuth } from "@/lib/cron-auth";
import {
  backfillDailyViews,
  fetchDailyViews,
  MetaRateLimitError,
  type DailyViewsRow,
} from "@/lib/meta-account-views";
import { brtDay, fetchReelsByDay } from "@/lib/meta-account-reels";

export const runtime = "nodejs";
export const maxDuration = 120;

// 1×/hora por conta: suficiente para o "Views Hoje" subir ao longo do dia (a
// Meta libera o dado do dia com atraso de qualquer forma) e ~3 consultas/hora
// por conta no máximo.
const RESYNC_AFTER_MS = 60 * 60_000;
const ACCOUNT_LIMIT = 60;
const CONCURRENCY = 3;
const RUN_BUDGET_MS = 95_000;
const RECENT_DAYS = [2, 1, 0];
const DAY_MS = 86_400_000;

interface AccountRow {
  id: string;
  user_id: string;
  username: string;
  ig_business_account_id: string | null;
  meta_access_token: string | null;
  views_backfilled_at: string | null;
  reels_backfilled_at: string | null;
}

export async function GET(request: NextRequest) {
  const cronAuth = requireCronAuth(request);
  if (!cronAuth.ok) return cronAuth.response;

  const admin = getSupabaseAdmin() as any;
  const now = Date.now();
  const staleIso = new Date(now - RESYNC_AFTER_MS).toISOString();

  const { data, error } = await admin
    .from("instagram_accounts")
    .select("id, user_id, username, ig_business_account_id, meta_access_token, views_backfilled_at, reels_backfilled_at")
    .neq("health_status", "error")
    .not("meta_access_token", "is", null)
    .not("ig_business_account_id", "is", null)
    // Conta sem backfill de reels entra já, mesmo com views recentes.
    .or(`views_synced_at.is.null,views_synced_at.lt.${staleIso},reels_backfilled_at.is.null`)
    .order("views_synced_at", { ascending: true, nullsFirst: true })
    .limit(ACCOUNT_LIMIT);

  if (error) {
    console.error("[cron/sync-account-views] Erro ao buscar contas:", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const accounts = (data ?? []) as AccountRow[];
  if (!accounts.length) {
    return NextResponse.json({ synced: 0, message: "Nenhuma conta pendente." });
  }

  const startedAt = Date.now();
  const summary = {
    synced: 0, backfilled: 0, partial: 0, rate_limited: 0, failed: 0, days_upserted: 0,
    reels_backfilled: 0, reels_days_upserted: 0, reels_failed: 0,
  };
  let cursor = 0;

  async function worker() {
    while (cursor < accounts.length) {
      if (Date.now() - startedAt > RUN_BUDGET_MS) return;
      const acc = accounts[cursor++];
      const igId = acc.ig_business_account_id!;
      const token = acc.meta_access_token!;

      try {
        const rows: DailyViewsRow[] = [];
        const needsBackfill = !acc.views_backfilled_at;
        let backfillFailures = 0;
        let lastError: string | null = null;
        if (needsBackfill) {
          const bf = await backfillDailyViews(igId, token);
          rows.push(...bf.rows);
          backfillFailures = bf.failures;
          lastError = bf.lastError;
        }
        const recent = await fetchDailyViews(igId, token, RECENT_DAYS);
        rows.push(...recent.rows);
        lastError = recent.lastError ?? lastError;
        if (backfillFailures || recent.failures) {
          summary.partial++;
          console.warn(
            `[cron/sync-account-views] @${acc.username}: ${backfillFailures + recent.failures} dia(s) recusado(s) pela Meta — retry no próximo run. ${lastError ?? ""}`
          );
        }

        if (rows.length) {
          const nowIso = new Date().toISOString();
          const { error: upErr } = await admin.from("account_views_daily").upsert(
            rows.map((r) => ({
              account_id: acc.id,
              user_id: acc.user_id,
              day: r.day,
              views: r.views,
              reach: r.reach,
              updated_at: nowIso,
            })),
            { onConflict: "account_id,day" }
          );
          if (upErr) throw new Error(upErr.message);
          summary.days_upserted += rows.length;
        }

        // Reels por dia BRT (card "Vídeos Publicados"). Falha aqui não derruba
        // as views já gravadas; rate limit só adia os reels para o próximo run.
        let reelsBackfillDone = false;
        try {
          const needsReelsBackfill = !acc.reels_backfilled_at;
          const recentDays = [2, 1, 0].map((d) => brtDay(now - d * DAY_MS));
          const reels = await fetchReelsByDay(igId, token, needsReelsBackfill ? null : recentDays[0]);
          // Dias recentes sem reel gravam 0: um reel apagado no Instagram sai da contagem.
          for (const day of recentDays) if (!reels.days.has(day)) reels.days.set(day, 0);
          const nowIso = new Date().toISOString();
          const { error: reelsErr } = await admin.from("account_reels_daily").upsert(
            [...reels.days].map(([day, count]) => ({
              account_id: acc.id,
              user_id: acc.user_id,
              day,
              reels: count,
              updated_at: nowIso,
            })),
            { onConflict: "account_id,day" }
          );
          if (reelsErr) throw new Error(reelsErr.message);
          summary.reels_days_upserted += reels.days.size;
          if (needsReelsBackfill && reels.complete) {
            reelsBackfillDone = true;
            summary.reels_backfilled++;
          }
        } catch (err) {
          summary.reels_failed++;
          console.warn(
            `[cron/sync-account-views] @${acc.username} reels:`,
            err instanceof Error ? err.message : String(err)
          );
        }

        const accUpdate: Record<string, string> = { views_synced_at: new Date().toISOString() };
        if (reelsBackfillDone) accUpdate.reels_backfilled_at = accUpdate.views_synced_at;
        // Backfill só é dado como concluído se nenhum dia falhou; senão refaz
        // no próximo run (os dias já obtidos ficam salvos — upsert idempotente).
        if (needsBackfill && backfillFailures === 0) {
          accUpdate.views_backfilled_at = accUpdate.views_synced_at;
          summary.backfilled++;
        }
        await admin.from("instagram_accounts").update(accUpdate).eq("id", acc.id);
        summary.synced++;
      } catch (err) {
        if (err instanceof MetaRateLimitError) {
          summary.rate_limited++;
          console.warn(`[cron/sync-account-views] @${acc.username}: rate limit — próximo run.`);
        } else {
          summary.failed++;
          console.warn(
            `[cron/sync-account-views] @${acc.username}:`,
            err instanceof Error ? err.message : String(err)
          );
        }
      }
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  console.log("[cron/sync-account-views] ✓", { ...summary, accounts: accounts.length });
  return NextResponse.json({ ...summary, accounts: accounts.length });
}
