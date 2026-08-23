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
    auto_caption_enabled, auto_caption_type,
    account_folder_ids, video_folder_ids,
  } = body as {
    name?: string; posts_per_day?: number; offset_seconds?: number;
    active?: boolean; captions?: string[];
    auto_caption_enabled?: boolean; auto_caption_type?: string | null;
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
  if (auto_caption_enabled !== undefined) {
    update.auto_caption_enabled = auto_caption_enabled;
    update.auto_caption_type = auto_caption_enabled ? (auto_caption_type ?? "curiosidades-gerais") : null;
  }

  if (Object.keys(update).length) {
    const { error } = await admin.from("automations").update(update).eq("id", id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Valida ownership das pastas antes de vincular — mesmo risco do POST: uma
  // pasta de outro usuário aqui faz o cron postar conteúdo/em contas alheias.
  if (account_folder_ids?.length || video_folder_ids?.length) {
    const [{ data: ownedAccFolders }, { data: ownedVidFolders }] = await Promise.all([
      account_folder_ids?.length
        ? admin.from("account_folders").select("id").in("id", account_folder_ids).eq("user_id", user.id)
        : Promise.resolve({ data: [] as { id: string }[] }),
      video_folder_ids?.length
        ? admin.from("library_folders").select("id").in("id", video_folder_ids).eq("user_id", user.id)
        : Promise.resolve({ data: [] as { id: string }[] }),
    ]);
    const ownedAccFolderIds = new Set((ownedAccFolders ?? []).map((f: { id: string }) => f.id));
    const ownedVidFolderIds = new Set((ownedVidFolders ?? []).map((f: { id: string }) => f.id));
    const badAcc = (account_folder_ids ?? []).filter((fid) => !ownedAccFolderIds.has(fid));
    const badVid = (video_folder_ids ?? []).filter((fid) => !ownedVidFolderIds.has(fid));
    if (badAcc.length > 0 || badVid.length > 0) {
      return NextResponse.json(
        { error: "Uma ou mais pastas não pertencem a este usuário." },
        { status: 400 }
      );
    }
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
