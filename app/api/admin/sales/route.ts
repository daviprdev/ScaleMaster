import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getSupabaseAdmin } from "@/lib/supabase";

export const dynamic = "force-dynamic";

// Brasil não tem horário de verão desde 2019 — offset fixo (mesma convenção
// usada em app/api/cron/daily-profit-notification/route.ts).
const BRT_OFFSET_MS = 3 * 60 * 60 * 1000;

function brtMidnightUtc(daysAgo: number): Date {
  const nowBrt = new Date(Date.now() - BRT_OFFSET_MS);
  const y = nowBrt.getUTCFullYear();
  const m = nowBrt.getUTCMonth();
  const d = nowBrt.getUTCDate();
  return new Date(Date.UTC(y, m, d - daysAgo, 0, 0, 0) + BRT_OFFSET_MS);
}

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: roleData } = await supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", user.id)
    .single();
  if (roleData?.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const admin = getSupabaseAdmin();

  const todayStart = brtMidnightUtc(0).toISOString();
  const weekStart = brtMidnightUtc(6).toISOString();
  const monthStart = brtMidnightUtc(29).toISOString();

  const [{ data: allSales, error }, { data: recent }] = await Promise.all([
    admin.from("sales").select("amount, created_at").not("amount", "is", null),
    admin
      .from("sales")
      .select("id, amount, currency, customer_identifier, source, created_at, raw_payload")
      .order("created_at", { ascending: false })
      .limit(50),
  ]);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const sum = (rows: { amount: number | null; created_at: string }[], sinceIso: string) =>
    rows
      .filter((r) => r.created_at >= sinceIso)
      .reduce((acc, r) => acc + Number(r.amount ?? 0), 0);

  const rows = allSales ?? [];

  const totals = {
    today: sum(rows, todayStart),
    week: sum(rows, weekStart),
    month: sum(rows, monthStart),
    allTime: sum(rows, "1970-01-01T00:00:00.000Z"),
    count: rows.length,
  };

  const sales = (recent ?? []).map((s: any) => ({
    id: s.id,
    amount: s.amount != null ? Number(s.amount) : null,
    currency: s.currency,
    customer: s.customer_identifier ?? s.raw_payload?.customer?.profile_name ?? null,
    planName: s.raw_payload?.transaction?.plan_name ?? null,
    source: s.source,
    createdAt: s.created_at,
  }));

  return NextResponse.json({ totals, sales });
}
