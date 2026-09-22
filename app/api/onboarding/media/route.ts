import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getSupabaseAdmin } from "@/lib/supabase";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const BUCKET = "onboarding-media";
const MAX_FILE_SIZE = 100 * 1024 * 1024; // 100 MB
const ALLOWED_MIME_TYPES = new Set([
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
  "video/mp4",
  "video/quicktime",
]);

const SAFE_COLUMNS = "id, category, name, storage_path, url, mime_type, file_size, created_at";

// GET - lista mídias do usuário (opcionalmente filtradas por categoria)
export async function GET(req: NextRequest) {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
    return NextResponse.json({ media: [] });
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  const category = req.nextUrl.searchParams.get("category");

  let query = supabase
    .from("onboarding_media_library")
    .select(SAFE_COLUMNS)
    .eq("user_id", user.id)
    .order("created_at", { ascending: false });

  if (category === "profile_photo" || category === "story_media") {
    query = query.eq("category", category);
  }

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ media: data ?? [] });
}

// POST - faz upload de uma mídia (multipart/form-data)
export async function POST(req: NextRequest) {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
    return NextResponse.json({ error: "Supabase não configurado" }, { status: 503 });
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  const formData = await req.formData();
  const file = formData.get("file") as File | null;
  const category = formData.get("category") as string | null;
  const name = formData.get("name") as string | null;

  if (!file) {
    return NextResponse.json({ error: "Arquivo obrigatório." }, { status: 400 });
  }

  if (category !== "profile_photo" && category !== "story_media") {
    return NextResponse.json({ error: "Categoria inválida (profile_photo ou story_media)." }, { status: 400 });
  }

  if (!name || !name.trim()) {
    return NextResponse.json({ error: "Nome obrigatório." }, { status: 400 });
  }

  if (file.size > MAX_FILE_SIZE) {
    return NextResponse.json({ error: `Arquivo muito grande (máx ${MAX_FILE_SIZE / 1024 / 1024} MB).` }, { status: 400 });
  }

  if (!ALLOWED_MIME_TYPES.has(file.type)) {
    return NextResponse.json({ error: `Tipo de arquivo não suportado: ${file.type}` }, { status: 400 });
  }

  // Gera caminho único no storage: {user_id}/{category}/{uuid}.{ext}
  const ext = file.name.split(".").pop() ?? "bin";
  const crypto = await import("crypto");
  const uuid = crypto.randomUUID();
  const storagePath = `${user.id}/${category}/${uuid}.${ext}`;

  // Upload para Supabase Storage
  const admin = getSupabaseAdmin();
  const arrayBuffer = await file.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  const { error: uploadError } = await admin.storage
    .from(BUCKET)
    .upload(storagePath, buffer, {
      contentType: file.type,
      upsert: false,
    });

  if (uploadError) {
    console.error("[onboarding-media] Upload error:", uploadError);
    return NextResponse.json({ error: `Falha no upload: ${uploadError.message}` }, { status: 500 });
  }

  // Obtém URL pública
  const { data: publicUrlData } = admin.storage
    .from(BUCKET)
    .getPublicUrl(storagePath);

  if (!publicUrlData?.publicUrl) {
    return NextResponse.json({ error: "Falha ao obter URL pública." }, { status: 500 });
  }

  // Salva registro no banco
  const { data, error } = await admin
    .from("onboarding_media_library")
    .insert({
      user_id: user.id,
      category,
      name: name.trim().slice(0, 200),
      storage_path: storagePath,
      url: publicUrlData.publicUrl,
      mime_type: file.type,
      file_size: file.size,
    })
    .select(SAFE_COLUMNS)
    .single();

  if (error) {
    // Rollback: remove o arquivo do storage se o insert falhar
    await admin.storage.from(BUCKET).remove([storagePath]);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ media: data }, { status: 201 });
}