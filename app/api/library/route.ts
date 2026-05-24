import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";

export const runtime = "nodejs";

const PAGE_SIZE = 16;

// GET /api/library — lista vídeos de uma pasta específica (folderId obrigatório)
// ?folderId=<uuid> → vídeos na pasta especificada
// ?page=N          → página N (0-indexed)
export async function GET(req: NextRequest) {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
    return NextResponse.json({ error: "Supabase não configurado." }, { status: 503 });
  }

  const folderId = req.nextUrl.searchParams.get("folderId");
  if (!folderId) {
    return NextResponse.json({ error: "folderId é obrigatório." }, { status: 400 });
  }

  const page = Math.max(0, parseInt(req.nextUrl.searchParams.get("page") ?? "0", 10) || 0);
  const from = page * PAGE_SIZE;
  const to = from + PAGE_SIZE - 1;

  const { data, error } = await getSupabaseAdmin()
    .from("videos_library")
    .select("*")
    .eq("folder_id", folderId)
    .order("created_at", { ascending: false })
    .range(from, to);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const videos = (data ?? []) as Array<Record<string, unknown>>;
  return NextResponse.json({
    videos,
    hasMore: videos.length === PAGE_SIZE,
    page,
  });
}

// PATCH /api/library — move vídeo para pasta (ou para raiz)
export async function PATCH(req: NextRequest) {
  const { id, folder_id } = await req.json() as { id: string; folder_id: string | null };

  if (!id) {
    return NextResponse.json({ error: "'id' obrigatório." }, { status: 400 });
  }

  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
    return NextResponse.json({ error: "Supabase não configurado." }, { status: 503 });
  }

  const { error } = await getSupabaseAdmin()
    .from("videos_library")
    .update({ folder_id: folder_id ?? null } as unknown as Record<string, unknown>)
    .eq("id", id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}

// DELETE /api/library — remove vídeo do Storage e do banco
export async function DELETE(req: NextRequest) {
  const { id, storage_path } = await req.json() as {
    id: string;
    storage_path: string;
  };

  if (!id || !storage_path) {
    return NextResponse.json(
      { error: "Campos 'id' e 'storage_path' são obrigatórios." },
      { status: 400 }
    );
  }

  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
    return NextResponse.json({ error: "Supabase não configurado." }, { status: 503 });
  }

  const admin = getSupabaseAdmin();

  const isDirectUrl = storage_path.startsWith("direct/");
  if (!isDirectUrl) {
    const { error: storageError } = await admin.storage
      .from("videos-library")
      .remove([storage_path]);

    if (storageError && !storageError.message.toLowerCase().includes("not found")) {
      console.error("[library DELETE] storage error:", storageError.message);
    }
  }

  const { error: dbError } = await admin
    .from("videos_library")
    .delete()
    .eq("id", id);

  if (dbError) {
    return NextResponse.json({ error: dbError.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
