import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function PATCH(req: NextRequest) {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
    return NextResponse.json({ error: "Supabase não configurado." }, { status: 503 });
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  const { videoIds, folderId } = await req.json() as { videoIds: string[]; folderId: string | null };

  if (!Array.isArray(videoIds) || videoIds.length === 0) {
    return NextResponse.json({ error: "'videoIds' obrigatório." }, { status: 400 });
  }

  const admin = getSupabaseAdmin();

  // Se movendo para uma pasta específica, confirma que ela pertence ao usuário
  if (folderId) {
    const { data: folder } = await admin
      .from("library_folders")
      .select("id")
      .eq("id", folderId)
      .eq("user_id", user.id)
      .maybeSingle();
    if (!folder) return NextResponse.json({ error: "Pasta não encontrada." }, { status: 404 });
  }

  const { error, count } = await admin
    .from("videos_library")
    .update({ folder_id: folderId ?? null } as unknown as Record<string, unknown>, { count: "exact" })
    .eq("user_id", user.id)
    .in("id", videoIds);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true, updated: count ?? 0 });
}
