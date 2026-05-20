import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getSupabaseAdmin } from "@/lib/supabase";

export const dynamic = "force-dynamic";

async function requireAdmin() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: rd } = await supabase
    .from("user_roles").select("role").eq("user_id", user.id).single();
  if (rd?.role !== "admin") return null;
  return user;
}

export async function GET() {
  const admin = getSupabaseAdmin();
  const { data } = await admin
    .from("system_announcements")
    .select("id, message, created_at")
    .eq("is_active", true)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return NextResponse.json({ announcement: data ?? null });
}

export async function POST(req: NextRequest) {
  const user = await requireAdmin();
  if (!user) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { message } = await req.json() as { message?: string };
  if (!message?.trim())
    return NextResponse.json({ error: "Mensagem obrigatória" }, { status: 400 });

  const admin = getSupabaseAdmin();
  await admin.from("system_announcements")
    .update({ is_active: false }).eq("is_active", true);

  const { data, error } = await admin
    .from("system_announcements")
    .insert({ message: message.trim(), is_active: true, created_by: user.id })
    .select().single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ announcement: data });
}

export async function DELETE() {
  const user = await requireAdmin();
  if (!user) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const admin = getSupabaseAdmin();
  await admin.from("system_announcements")
    .update({ is_active: false }).eq("is_active", true);
  return NextResponse.json({ ok: true });
}
