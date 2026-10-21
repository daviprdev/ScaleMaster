/**
 * /api/cron/check-views-goal
 *
 * Verifica se algum usuário atingiu a meta diária de views configurada em
 * notification_settings.daily_views_goal. Quando atinge (e ainda não foi
 * notificado hoje), envia push notification com a mensagem padrão.
 *
 * Roda a cada 1 hora via systemd timer — dispara no horário configurado
 * pelo usuário (18:00, 20:00 ou 22:00 BRT), uma vez por dia.
 *
 * Depois, toda hora, apaga as leituras de views (post_views_snapshots, Raio-X
 * da fila) com mais de 7 dias.
 */

import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { sendPushNotification } from "@/lib/web-push";
import { getDailyViewsGoalMessage } from "@/lib/daily-views-goal-messages";
import { requireCronAuth } from "@/lib/cron-auth";
import { brtMidnightUtc } from "@/lib/brt-time";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

// Brasil não tem horário de verão desde 2019 — offset fixo.
const BRT_OFFSET_MS = 3 * 60 * 60 * 1000;
// Cron roda a cada 1 hora — dispara pra qualquer usuário cujo horário configurado
// caia na mesma janela de 60 min do momento atual (bucket = floor(minutos/60)).
const BUCKET_MINUTES = 60;

function getBrtNowMinutes(nowUtc: Date): number {
  const brtNow = new Date(nowUtc.getTime() - BRT_OFFSET_MS);
  return brtNow.getUTCHours() * 60 + brtNow.getUTCMinutes();
}

function parseTimeToMinutes(hhmm: string): number | null {
  const match = /^(\d{2}):(\d{2})$/.exec(hhmm);
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

// Leituras de views guardadas pelo trigger de supabase/fila_ideal.sql: o Raio-X
// da fila só olha as últimas 48h, então 7 dias sobram.
const SNAPSHOT_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

export async function GET(request: NextRequest) {
  const cronAuth = requireCronAuth(request);
  if (!cronAuth.ok) return cronAuth.response;

  const admin = getSupabaseAdmin();
  try {
    return await checkViewsGoal(admin);
  } finally {
    // Toda hora, inclusive quando ninguém está no horário da meta.
    await purgeOldViewSnapshots(admin);
  }
}

/**
 * Apaga as leituras de post_views_snapshots com mais de 7 dias. Nunca derruba
 * o cron: sem a tabela (SQL ainda não aplicado) fica quieto; outro erro só vai
 * para o log.
 */
async function purgeOldViewSnapshots(admin: ReturnType<typeof getSupabaseAdmin>): Promise<void> {
  try {
    const cutoff = new Date(Date.now() - SNAPSHOT_RETENTION_MS).toISOString();
    const { count, error } = await admin
      .from("post_views_snapshots")
      .delete({ count: "exact" })
      .lt("read_at", cutoff);
    if (error) {
      const msg = error.message ?? "";
      const missingTable = error.code === "42P01" || error.code === "PGRST205" ||
        (msg.includes("post_views_snapshots") && /does not exist|schema cache/i.test(msg));
      if (!missingTable) {
        console.warn("[cron/check-views-goal] Falha ao purgar post_views_snapshots:", error.message);
      }
      return;
    }
    if (count) console.log(`[cron/check-views-goal] ${count} leitura(s) de views com +7 dias apagadas.`);
  } catch (err) {
    console.warn("[cron/check-views-goal] Falha ao purgar post_views_snapshots:", err);
  }
}

async function checkViewsGoal(admin: ReturnType<typeof getSupabaseAdmin>): Promise<NextResponse> {
  const nowUtc = new Date();
  const todayStartIso = brtMidnightUtc(0).toISOString();
  const dateKey = todayStartIso.slice(0, 10); // YYYY-MM-DD
  const currentMinutes = getBrtNowMinutes(nowUtc);
  const currentBucket = Math.floor(currentMinutes / BUCKET_MINUTES);

  // Busca usuários com meta de views ativada
  const { data: settingsRows, error: settingsErr } = await admin
    .from("notification_settings")
    .select("user_id, daily_views_goal_enabled, daily_views_goal, daily_views_goal_time")
    .eq("daily_views_goal_enabled", true)
    .gt("daily_views_goal", 0);

  if (settingsErr) {
    console.error("[cron/check-views-goal] Erro ao buscar settings:", settingsErr.message);
    return NextResponse.json({ error: settingsErr.message }, { status: 500 });
  }

  // Filtra apenas usuários cujo horário configurado cai no bucket atual
  const dueSettings = (settingsRows ?? []).filter((s: { daily_views_goal_time: string }) => {
    const minutes = parseTimeToMinutes(s.daily_views_goal_time || "18:00");
    if (minutes == null) return false;
    return Math.floor(minutes / BUCKET_MINUTES) === currentBucket;
  }) as {
    user_id: string;
    daily_views_goal_enabled: boolean;
    daily_views_goal: number;
    daily_views_goal_time: string;
  }[];

  if (dueSettings.length === 0) {
    return NextResponse.json({ skipped: "no_users_due", dateKey, currentBucket });
  }

  const results = [];

  for (const setting of dueSettings) {
    const { user_id, daily_views_goal } = setting;

    // Soma views de hoje do usuário (todas as contas)
    const { data: viewsData, error: viewsErr } = await admin
      .from("account_views_daily")
      .select("views")
      .eq("user_id", user_id)
      .eq("day", dateKey);

    if (viewsErr) {
      console.error(`[cron/check-views-goal] Erro ao buscar views para ${user_id}:`, viewsErr.message);
      results.push({ userId: user_id, error: viewsErr.message });
      continue;
    }

    const totalViews = (viewsData ?? []).reduce((sum, row) => sum + Number(row.views ?? 0), 0);

    // Verifica se já atingiu a meta
    if (totalViews < daily_views_goal) {
      results.push({ userId: user_id, skipped: "goal_not_reached", currentViews: totalViews, goal: daily_views_goal });
      continue;
    }

    // Verifica se já foi notificado hoje
    const { data: alreadyNotified } = await admin
      .from("notifications")
      .select("id")
      .eq("type", "system")
      .eq("target_user_id", user_id)
      .contains("data", { viewsGoalDate: dateKey })
      .maybeSingle();

    if (alreadyNotified) {
      results.push({ userId: user_id, skipped: "already_notified_today" });
      continue;
    }

    // Envia notificação
    const { title, body } = getDailyViewsGoalMessage(totalViews, daily_views_goal);

    try {
      const result = await sendPushNotification({
        targetType: "user",
        targetUserId: user_id,
        type: "system",
        title,
        body,
        url: "/dashboard",
        extraData: { viewsGoalDate: dateKey, currentViews: totalViews, goal: daily_views_goal },
      });
      results.push({ userId: user_id, ...result, sent: true, currentViews: totalViews, goal: daily_views_goal });
    } catch (err) {
      console.error(`[cron/check-views-goal] Erro ao enviar push para ${user_id}:`, err);
      results.push({ userId: user_id, error: String(err) });
    }
  }

  console.log("[cron/check-views-goal] ✓", { dateKey, currentBucket, checked: dueSettings.length, results });
  return NextResponse.json({ dateKey, currentBucket, checked: dueSettings.length, results });
}