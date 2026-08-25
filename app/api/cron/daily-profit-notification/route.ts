import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { sendPushNotification } from "@/lib/web-push";
import { getDailyProfitMessage } from "@/lib/daily-profit-messages";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

// Brasil não tem horário de verão desde 2019 — offset fixo.
const BRT_OFFSET_MS = 3 * 60 * 60 * 1000;
// Cron roda a cada 15 min — dispara pra qualquer admin cujo horário configurado
// caia na mesma janela de 15 min do momento atual (bucket = floor(minutos/15)).
const BUCKET_MINUTES = 15;

function getBrtDayWindowUtc(nowUtc: Date) {
  const brtNow = new Date(nowUtc.getTime() - BRT_OFFSET_MS);
  const y = brtNow.getUTCFullYear();
  const m = brtNow.getUTCMonth();
  const d = brtNow.getUTCDate();
  const dateKey = `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  const startUtc = new Date(Date.UTC(y, m, d, 0, 0, 0) + BRT_OFFSET_MS);
  const endUtc = new Date(startUtc.getTime() + 24 * 60 * 60 * 1000);
  const currentMinutes = brtNow.getUTCHours() * 60 + brtNow.getUTCMinutes();
  return { dateKey, startUtc, endUtc, currentMinutes };
}

function parseTimeToMinutes(hhmm: string): number | null {
  const match = /^(\d{2}):(\d{2})$/.exec(hhmm);
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

export async function GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization");
  if (!cronSecret) {
    console.warn("[cron] AVISO: CRON_SECRET nao configurado.");
  } else if (auth !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = getSupabaseAdmin();
  const { dateKey, startUtc, endUtc, currentMinutes } = getBrtDayWindowUtc(new Date());
  const currentBucket = Math.floor(currentMinutes / BUCKET_MINUTES);

  const { data: admins } = await admin.from("user_roles").select("user_id").eq("role", "admin");
  const adminIds = (admins ?? []).map((a: { user_id: string }) => a.user_id);
  if (adminIds.length === 0) return NextResponse.json({ skipped: "no_admins" });

  const { data: settingsRows } = await admin
    .from("notification_settings")
    .select("user_id, daily_profit_enabled, daily_profit_time")
    .in("user_id", adminIds);

  const dueAdmins = (settingsRows ?? []).filter((s: { daily_profit_enabled: boolean; daily_profit_time: string }) => {
    if (!s.daily_profit_enabled) return false;
    const minutes = parseTimeToMinutes(s.daily_profit_time);
    if (minutes == null) return false;
    return Math.floor(minutes / BUCKET_MINUTES) === currentBucket;
  }) as { user_id: string; daily_profit_enabled: boolean; daily_profit_time: string }[];

  if (dueAdmins.length === 0) {
    return NextResponse.json({ skipped: "no_admin_due", dateKey, currentBucket });
  }

  const yesterdayStartUtc = new Date(startUtc.getTime() - 24 * 60 * 60 * 1000);

  const [{ data: sales, error }, { data: yesterdaySales, error: yError }] = await Promise.all([
    admin.from("sales").select("amount").not("amount", "is", null).gte("created_at", startUtc.toISOString()).lt("created_at", endUtc.toISOString()),
    admin.from("sales").select("amount").not("amount", "is", null).gte("created_at", yesterdayStartUtc.toISOString()).lt("created_at", startUtc.toISOString()),
  ]);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (yError) return NextResponse.json({ error: yError.message }, { status: 500 });

  const total = (sales ?? []).reduce((sum, s) => sum + Number(s.amount ?? 0), 0);
  const yesterdayTotal = (yesterdaySales ?? []).reduce((sum, s) => sum + Number(s.amount ?? 0), 0);
  const { title, body } = getDailyProfitMessage(total, yesterdayTotal);

  const results = [];
  for (const a of dueAdmins) {
    const { data: already } = await admin
      .from("notifications")
      .select("id")
      .eq("type", "system")
      .eq("target_user_id", a.user_id)
      .contains("data", { profitDate: dateKey })
      .maybeSingle();

    if (already) {
      results.push({ userId: a.user_id, skipped: "already_sent" });
      continue;
    }

    const result = await sendPushNotification({
      targetType: "user",
      targetUserId: a.user_id,
      type: "system",
      title,
      body,
      url: "/admin",
      extraData: { profitDate: dateKey, total, yesterdayTotal },
    });
    results.push({ userId: a.user_id, ...result });
  }

  return NextResponse.json({ dateKey, total, yesterdayTotal, title, body, results });
}
