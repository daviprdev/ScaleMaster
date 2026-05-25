import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getSupabaseAdmin } from "@/lib/supabase";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) return NextResponse.json({ success: true });

  const { id } = await params;
  const { name } = await req.json() as { name: string };
  if (!name?.trim()) return NextResponse.json({ error: "Nome obrigatório." }, { status: 400 });

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  const { error } = await supabase
    .from("library_folders")
    .update({ name: name.trim() })
    .eq("id", id)
    .eq("user_id", user.id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}

export async function DELETE(
  _: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) return NextResponse.json({ success: true });

  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  // Verify folder ownership before doing anything destructive
  const { data: folder } = await supabase
    .from("library_folders")
    .select("id")
    .eq("id", id)
    .eq("user_id", user.id)
    .maybeSingle();

  if (!folder) return NextResponse.json({ error: "Pasta não encontrada." }, { status: 404 });

  const admin = getSupabaseAdmin();

  // Step 1: Fetch all videos in this folder
  const { data: videos } = await admin
    .from("videos_library")
    .select("id, storage_path")
    .eq("folder_id", id);

  if (videos && videos.length > 0) {
    // Step 2: Delete physical files from Storage (skip external/direct URLs)
    const storagePaths = (videos as Array<{ id: string; storage_path: string }>)
      .filter(v => v.storage_path && !v.storage_path.startsWith("direct/"))
      .map(v => v.storage_path);

    if (storagePaths.length > 0) {
      const { error: storageError } = await admin.storage
        .from("videos-library")
        .remove(storagePaths);
      if (storageError) {
        console.error("[folder DELETE] storage error:", storageError.message);
      }
    }

    // Step 3: Delete video records from DB
    const videoIds = (videos as Array<{ id: string }>).map(v => v.id);
    const { error: dbVideosError } = await admin
      .from("videos_library")
      .delete()
      .in("id", videoIds);

    if (dbVideosError) {
      return NextResponse.json({ error: dbVideosError.message }, { status: 500 });
    }
  }

  // Step 4: Delete the folder record
  const { error } = await supabase
    .from("library_folders")
    .delete()
    .eq("id", id)
    .eq("user_id", user.id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true, deleted: { videos: videos?.length ?? 0 } });
}
