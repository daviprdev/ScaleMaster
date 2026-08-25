import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getSupabaseAdmin } from "@/lib/supabase";

export const dynamic = "force-dynamic";

const DEFAULTS = {
  proxy_alerts_enabled: true,
  account_alerts_enabled: true,
  daily_profit_enabled: false,
  daily_profit_time: "23:55",
};

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const admin = getSupabaseAdmin();
  const { data } = await admin
    .from("notification_settings")
    .select("proxy_alerts_enabled, account_alerts_enabled, daily_profit_enabled, daily_profit_time")
    .eq("user_id", user.id)
    .maybeSingle();

  return NextResponse.json({ settings: data ?? DEFAULTS });
}

export async function PATCH(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await req.json()) as Partial<typeof DEFAULTS>;
  const patch: Record<string, unknown> = {};
  if (typeof body.proxy_alerts_enabled === "boolean") patch.proxy_alerts_enabled = body.proxy_alerts_enabled;
  if (typeof body.account_alerts_enabled === "boolean") patch.account_alerts_enabled = body.account_alerts_enabled;
  if (typeof body.daily_profit_enabled === "boolean") patch.daily_profit_enabled = body.daily_profit_enabled;
  if (typeof body.daily_profit_time === "string" && /^\d{2}:\d{2}$/.test(body.daily_profit_time)) {
    patch.daily_profit_time = body.daily_profit_time;
  }

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "Nenhum campo válido para atualizar" }, { status: 400 });
  }

  const admin = getSupabaseAdmin();
  const { data: existing } = await admin
    .from("notification_settings")
    .select("proxy_alerts_enabled, account_alerts_enabled, daily_profit_enabled, daily_profit_time")
    .eq("user_id", user.id)
    .maybeSingle();

  const { data, error } = await admin
    .from("notification_settings")
    .upsert(
      { user_id: user.id, ...DEFAULTS, ...(existing ?? {}), ...patch, updated_at: new Date().toISOString() },
      { onConflict: "user_id" }
    )
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ settings: data });
}
