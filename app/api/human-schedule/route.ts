import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getSupabaseAdmin } from "@/lib/supabase";

export const dynamic = "force-dynamic";

interface ScheduleSettings {
  user_id: string;
  is_active: boolean;
  start_time: string;
  end_time: string;
  timezone: string;
  updated_at: string;
}

// GET — fetch current user's settings (returns defaults if row not found)
export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data } = await supabase
    .from("human_schedule_settings")
    .select("*")
    .eq("user_id", user.id)
    .single();

  // Return defaults if no row yet
  const settings: ScheduleSettings = data
    ? (data as unknown as ScheduleSettings)
    : {
        user_id: user.id,
        is_active: false,
        start_time: "07:00",
        end_time: "23:00",
        timezone: "America/Sao_Paulo",
        updated_at: new Date().toISOString(),
      };

  return NextResponse.json({ settings });
}

// PUT — upsert settings
export async function PUT(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json() as Partial<ScheduleSettings>;

  const payload = {
    user_id: user.id,
    is_active: typeof body.is_active === "boolean" ? body.is_active : false,
    start_time: body.start_time ?? "07:00",
    end_time: body.end_time ?? "23:00",
    timezone: body.timezone ?? "America/Sao_Paulo",
  };

  const admin = getSupabaseAdmin();
  const { error } = await admin
    .from("human_schedule_settings")
    .upsert(payload as never, { onConflict: "user_id" });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
