import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { sendPushNotification } from "@/lib/web-push";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

// Brasil não tem horário de verão desde 2019 — offset fixo.
const BRT_OFFSET_MS = 3 * 60 * 60 * 1000;

function getBrtDayWindowUtc(nowUtc: Date) {
  const brtNow = new Date(nowUtc.getTime() - BRT_OFFSET_MS);
  const y = brtNow.getUTCFullYear();
  const m = brtNow.getUTCMonth();
  const d = brtNow.getUTCDate();
  const dateKey = `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  const startUtc = new Date(Date.UTC(y, m, d, 0, 0, 0) + BRT_OFFSET_MS);
  const endUtc = new Date(startUtc.getTime() + 24 * 60 * 60 * 1000);
  return { dateKey, startUtc, endUtc };
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
  const { dateKey, startUtc, endUtc } = getBrtDayWindowUtc(new Date());

  const { data: already } = await admin
    .from("notifications")
    .select("id")
    .eq("type", "system")
    .contains("data", { profitDate: dateKey })
    .maybeSingle();

  if (already) {
    return NextResponse.json({ skipped: "already_sent", dateKey });
  }

  const { data: sales, error } = await admin
    .from("sales")
    .select("amount")
    .not("amount", "is", null)
    .gte("created_at", startUtc.toISOString())
    .lt("created_at", endUtc.toISOString());

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const total = (sales ?? []).reduce((sum, s) => sum + Number(s.amount ?? 0), 0);
  const formatted = total.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const result = await sendPushNotification({
    targetType: "admins",
    type: "system",
    title: "Lucro diário",
    body: `Faturamento de hoje (${dateKey}): R$ ${formatted}`,
    url: "/admin",
    extraData: { profitDate: dateKey, total },
  });

  return NextResponse.json({ dateKey, total, ...result });
}
