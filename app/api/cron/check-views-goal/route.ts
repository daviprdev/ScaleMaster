/**
 * /api/cron/check-views-goal
 *
 * Verifica se algum usuário atingiu a meta diária de views configurada em
 * notification_settings.daily_views_goal. Quando atinge (e ainda não foi
 * notificado hoje), envia push notification com a mensagem padrão.
 *
 * Roda a cada 15 min via systemd timer — dispara no horário configurado
 * pelo usuário (18:00, 20:00 ou 22:00 BRT), uma vez por dia.
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
// Cron roda a cada 15 min — dispara pra qualquer usuário cujo horário configurado
// caia na mesma janela de 15 min do momento atual (bucket = floor(minutos/15)).
const BUCKET_MINUTES = 15;

function getBrtNowMinutes(nowUtc: Date): number {
  const brtNow = new Date(nowUtc.getTime() - BRT_OFFSET_MS);
  return brtNow.getUTCHours() * 60 + brtNow.getUTCMinutes();
}

function parseTimeToMinutes(hhmm: string): number | null {
  const match = /^(\d{2}):(\d{2})$/.exec(hhmm);
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

export async function GET(request: NextRequest) {
  const cronAuth = requireCronAuth(request);
  if (!cronAuth.ok) return cronAuth.response;

  const admin = getSupabaseAdmin();
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