import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getSupabaseAdmin } from "@/lib/supabase";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// POST /api/library/cleanup-orphans
// Finds and permanently deletes all videos that have no valid folder (folder_id IS NULL
// or points to a deleted folder). Used to unblock the anti-duplicate check after
// a folder was deleted without cascading its videos.
export async function POST(_: NextRequest) {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
    return NextResponse.json({ deleted: 0, message: "Supabase não configurado." });
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  const admin = getSupabaseAdmin();

  // Collect all valid folder IDs for this user
  const { data: validFolders } = await admin
    .from("library_folders")
    .select("id")
    .eq("user_id", user.id);

  const validFolderIds = new Set((validFolders ?? []).map(f => f.id as string));

  // Fetch all videos for this user
  const { data: allVideos, error: fetchError } = await admin
    .from("videos_library")
    .select("id, storage_path, folder_id")
    .eq("user_id", user.id);

  if (fetchError) {
    return NextResponse.json({ error: fetchError.message }, { status: 500 });
  }

  type VideoRow = { id: string; storage_path: string; folder_id: string | null };

  // Orphaned = folder_id is null OR points to a folder that no longer exists
  const orphans = ((allVideos ?? []) as VideoRow[]).filter(
    v => v.folder_id === null || !validFolderIds.has(v.folder_id)
  );

  if (orphans.length === 0) {
    return NextResponse.json({ deleted: 0, message: "Nenhum arquivo órfão encontrado." });
  }

  // Delete physical files from Storage
  const storagePaths = orphans
    .filter(v => v.storage_path && !v.storage_path.startsWith("direct/"))
    .map(v => v.storage_path);

  if (storagePaths.length > 0) {
    const { error: storageError } = await admin.storage
      .from("videos-library")
      .remove(storagePaths);
    if (storageError) {
      console.error("[cleanup-orphans] storage error:", storageError.message);
    }
  }

  // Delete DB records
  const orphanIds = orphans.map(v => v.id);
  const { error: dbError } = await admin
    .from("videos_library")
    .delete()
    .in("id", orphanIds);

  if (dbError) {
    return NextResponse.json({ error: dbError.message }, { status: 500 });
  }

  return NextResponse.json({
    deleted: orphans.length,
    message: `${orphans.length} arquivo(s) órfão(s) removido(s) com sucesso.`,
  });
}
