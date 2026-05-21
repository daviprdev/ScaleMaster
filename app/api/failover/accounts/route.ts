import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getSupabaseAdmin } from "@/lib/supabase";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// GET — ordered account list with health + priority
export async function GET() {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
    return NextResponse.json({ accounts: [] });
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  const { data, error } = await (getSupabaseAdmin() as any)
    .from("instagram_accounts")
    .select("id, username, display_name, is_active, health_status, failover_priority")
    .eq("user_id", user.id)
    .order("failover_priority", { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ accounts: data ?? [] });
}

// PATCH — bulk-update failover_priority for a user's accounts
export async function PATCH(req: NextRequest) {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
    return NextResponse.json({ success: true });
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  const body = await req.json() as { updates: { id: string; failover_priority: number }[] };
  if (!Array.isArray(body.updates) || body.updates.length === 0) {
    return NextResponse.json({ error: "updates inválido" }, { status: 400 });
  }

  const admin = getSupabaseAdmin() as any;
  await Promise.all(
    body.updates.map(({ id, failover_priority }) =>
      admin
        .from("instagram_accounts")
        .update({ failover_priority })
        .eq("id", id)
        .eq("user_id", user.id)
    )
  );

  return NextResponse.json({ success: true });
}

// PUT — reset health_status of a single account back to 'online'
export async function PUT(req: NextRequest) {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
    return NextResponse.json({ success: true });
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  const body = await req.json() as { id: string };
  if (!body.id) return NextResponse.json({ error: "id inválido" }, { status: 400 });

  const { error } = await (getSupabaseAdmin() as any)
    .from("instagram_accounts")
    .update({ health_status: "online" })
    .eq("id", body.id)
    .eq("user_id", user.id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
