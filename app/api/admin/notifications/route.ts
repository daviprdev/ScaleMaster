import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { sendPushNotification, type NotificationTargetType } from "@/lib/web-push";

export const dynamic = "force-dynamic";

async function requireAdmin() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: rd } = await supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", user.id)
    .single();
  if (rd?.role !== "admin") return null;
  return user;
}

export async function GET() {
  const user = await requireAdmin();
  if (!user) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const admin = getSupabaseAdmin();
  const { data, error } = await admin
    .from("notifications")
    .select("id, target_type, target_user_id, type, title, body, sent_count, failed_count, created_at")
    .order("created_at", { ascending: false })
    .limit(50);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ notifications: data ?? [] });
}

export async function POST(req: NextRequest) {
  const user = await requireAdmin();
  if (!user) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = (await req.json()) as {
    target_type?: NotificationTargetType;
    target_user_id?: string;
    title?: string;
    body?: string;
    url?: string;
  };

  const { target_type, target_user_id, title, body: msgBody, url } = body;

  if (!target_type || !["all", "admins", "user"].includes(target_type)) {
    return NextResponse.json({ error: "target_type inválido" }, { status: 400 });
  }
  if (target_type === "user" && !target_user_id) {
    return NextResponse.json({ error: "target_user_id obrigatório para target_type='user'" }, { status: 400 });
  }
  if (!title?.trim() || !msgBody?.trim()) {
    return NextResponse.json({ error: "title e body são obrigatórios" }, { status: 400 });
  }

  try {
    const result = await sendPushNotification({
      targetType: target_type,
      targetUserId: target_user_id ?? null,
      type: "admin",
      title: title.trim(),
      body: msgBody.trim(),
      url: url?.trim() || undefined,
      createdBy: user.id,
    });
    return NextResponse.json(result);
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? "Erro ao enviar notificação" }, { status: 500 });
  }
}
