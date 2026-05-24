import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";

export const runtime = "nodejs";

export async function PATCH(req: NextRequest) {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
    return NextResponse.json({ error: "Supabase não configurado." }, { status: 503 });
  }

  const { videoIds, folderId } = await req.json() as { videoIds: string[]; folderId: string | null };

  if (!Array.isArray(videoIds) || videoIds.length === 0) {
    return NextResponse.json({ error: "'videoIds' obrigatório." }, { status: 400 });
  }

  const { error } = await getSupabaseAdmin()
    .from("videos_library")
    .update({ folder_id: folderId ?? null } as unknown as Record<string, unknown>)
    .in("id", videoIds);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true, updated: videoIds.length });
}
