import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getSupabaseAdmin } from "@/lib/supabase";

export const runtime = "nodejs";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const {
    name, posts_per_day, offset_seconds, active, captions,
    account_folder_ids, video_folder_ids,
  } = body as {
    name?: string; posts_per_day?: number; offset_seconds?: number;
    active?: boolean; captions?: string[];
    account_folder_ids?: string[]; video_folder_ids?: string[];
  };

  const admin = getSupabaseAdmin();

  // Verifica ownership
  const { data: existing } = await admin
    .from("automations").select("id, user_id").eq("id", id).single();
  if (!existing || existing.user_id !== user.id)
    return NextResponse.json({ error: "Não encontrado." }, { status: 404 });

  const update: Record<string, unknown> = {};
  if (name !== undefined) update.name = name.trim();
  if (posts_per_day !== undefined) update.posts_per_day = posts_per_day;
  if (offset_seconds !== undefined) update.offset_seconds = offset_seconds;
  if (active !== undefined) update.active = active;
  if (captions !== undefined) update.captions = captions.map((c: string) => c.trim()).filter(Boolean);

  if (Object.keys(update).length) {
    const { error } = await admin.from("automations").update(update).eq("id", id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Atualiza relações se fornecidas
  if (account_folder_ids !== undefined) {
    await admin.from("automation_account_folders").delete().eq("automation_id", id);
    if (account_folder_ids.length) {
      await admin.from("automation_account_folders").insert(account_folder_ids.map((fid) => ({ automation_id: id, folder_id: fid })));
    }
  }
  if (video_folder_ids !== undefined) {
    await admin.from("automation_video_folders").delete().eq("automation_id", id);
    if (video_folder_ids.length) {
      await admin.from("automation_video_folders").insert(video_folder_ids.map((fid) => ({ automation_id: id, folder_id: fid })));
    }
  }

  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });

  const admin = getSupabaseAdmin();

  const { data: existing } = await admin
    .from("automations").select("id, user_id").eq("id", id).single();
  if (!existing || existing.user_id !== user.id)
    return NextResponse.json({ error: "Não encontrado." }, { status: 404 });

  // Cancela posts pendentes antes de deletar
  await admin.from("scheduled_posts")
    .update({ status: "cancelled" })
    .eq("campaign_id", id)
    .in("status", ["pending"]);

  await admin.from("automations").delete().eq("id", id);
  return NextResponse.json({ ok: true });
}
