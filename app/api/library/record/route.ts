import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const { storagePath, filename, fileSize, folderId } = await req.json() as {
    storagePath: string;
    filename: string;
    fileSize: number;
    folderId: string;
  };

  if (!storagePath || !filename) {
    return NextResponse.json(
      { error: "storagePath e filename são obrigatórios." },
      { status: 400 }
    );
  }

  if (!folderId) {
    return NextResponse.json(
      { error: "folderId é obrigatório. Selecione uma pasta antes de fazer upload." },
      { status: 400 }
    );
  }

  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
    return NextResponse.json({
      success: true,
      record: {
        id: `mock_${Date.now()}`,
        filename,
        public_url: "",
        storage_path: storagePath,
        file_size: fileSize ?? 0,
        owner_username: null,
        caption: null,
        views: 0,
        likes: 0,
        comments: 0,
        duration: 0,
        created_at: new Date().toISOString(),
      },
    });
  }

  const supabaseUser = await createClient();
  const { data: { user } } = await supabaseUser.auth.getUser();
  const userId = user?.id ?? null;

  const { data: urlData } = getSupabaseAdmin().storage
    .from("videos-library")
    .getPublicUrl(storagePath);

  const insertPayload: Record<string, unknown> = {
    user_id: userId,
    filename,
    original_url: null,
    storage_path: storagePath,
    public_url: urlData.publicUrl,
    file_size: fileSize ?? 0,
    owner_username: null,
    caption: null,
    views: 0,
    likes: 0,
    comments: 0,
    duration: 0,
  };
  insertPayload.folder_id = folderId;

  const { data: record, error } = await getSupabaseAdmin()
    .from("videos_library")
    .insert(insertPayload as never)
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true, record });
}
