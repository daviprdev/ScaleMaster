import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { createClient } from "@/lib/supabase/server";
import { getSupabaseAdmin } from "@/lib/supabase";

export const runtime = "nodejs";
// Aumenta limite para uploads de vídeo (padrão Next.js é 4MB)
export const maxDuration = 60;

const VALID_TYPES = ["image/jpeg", "image/jpg", "image/png", "video/mp4", "video/quicktime"];
const MAX_IMAGE_SIZE = 8 * 1024 * 1024;   // 8 MB
const MAX_VIDEO_SIZE = 100 * 1024 * 1024; // 100 MB

export async function POST(req: NextRequest) {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
    return NextResponse.json({ error: "Storage não configurado." }, { status: 500 });
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });

  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return NextResponse.json({ error: "Falha ao ler o arquivo." }, { status: 400 });
  }

  const file = formData.get("file") as File | null;
  if (!file) return NextResponse.json({ error: "Nenhum arquivo enviado." }, { status: 400 });

  if (!VALID_TYPES.includes(file.type)) {
    return NextResponse.json({ error: `Tipo inválido: ${file.type}. Use JPG, PNG ou MP4.` }, { status: 400 });
  }

  const isImage = file.type.startsWith("image/");
  const maxSize = isImage ? MAX_IMAGE_SIZE : MAX_VIDEO_SIZE;
  if (file.size > maxSize) {
    return NextResponse.json({
      error: `Arquivo muito grande (${(file.size / 1024 / 1024).toFixed(1)} MB). Máximo: ${maxSize / 1024 / 1024} MB.`,
    }, { status: 400 });
  }

  const ext = file.type === "image/png" ? ".png" : isImage ? ".jpg" : ".mp4";
  const storagePath = `stories/${user.id}/${randomUUID()}${ext}`;

  const buffer = Buffer.from(await file.arrayBuffer());

  const admin = getSupabaseAdmin();
  const { error: uploadErr } = await admin.storage
    .from("videos-library")
    .upload(storagePath, buffer, { contentType: file.type, upsert: false });

  if (uploadErr) {
    return NextResponse.json({ error: `Falha no upload: ${uploadErr.message}` }, { status: 500 });
  }

  const { data: urlData } = admin.storage.from("videos-library").getPublicUrl(storagePath);

  return NextResponse.json({
    url: urlData.publicUrl,
    media_type: isImage ? "image" : "video",
    filename: file.name,
    storage_path: storagePath,
    size: file.size,
  });
}
