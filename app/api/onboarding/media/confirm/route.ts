import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getSupabaseAdmin } from "@/lib/supabase";

export const dynamic = "force-dynamic";

const BUCKET = "onboarding-media";
const SAFE_COLUMNS = "id, category, name, storage_path, url, mime_type, file_size, created_at";

// POST - confirma o upload e registra o metadata no banco
// Chamado pelo frontend APÓS o upload direto no Supabase Storage
export async function POST(req: NextRequest) {
 if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
 return NextResponse.json({ error: "Supabase não configurado" }, { status: 503 });
 }

 const supabase = await createClient();
 const { data: { user } } = await supabase.auth.getUser();
 if (!user) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

 let body: {
 storagePath?: string;
 category?: string;
 name?: string;
 mimeType?: string;
 fileSize?: number;
 };

 try {
 body = await req.json();
 } catch {
 return NextResponse.json({ error: "Corpo da requisição inválido." }, { status: 400 });
 }

 const { storagePath, category, name, mimeType, fileSize } = body;

 if (!storagePath || !category || !name) {
 return NextResponse.json({ error: "Campos obrigatórios: storagePath, category, name." }, { status: 400 });
 }

 if (category !== "profile_photo" && category !== "story_media") {
 return NextResponse.json({ error: "Categoria inválida." }, { status: 400 });
 }

 // Obtém URL pública do arquivo no storage
 const admin = getSupabaseAdmin();
 const { data: fileData } = admin.storage
 .from(BUCKET)
 .getPublicUrl(storagePath);

 if (!fileData?.publicUrl) {
 return NextResponse.json({ error: "Falha ao obter URL do storage." }, { status: 500 });
 }

 // Salva registro no banco
 const { data, error } = await admin
 .from("onboarding_media_library")
 .insert({
 user_id: user.id,
 category,
 name: name.trim().slice(0, 200),
 storage_path: storagePath,
 url: fileData.publicUrl,
 mime_type: mimeType ?? null,
 file_size: fileSize ?? null,
 })
 .select(SAFE_COLUMNS)
 .single();

 if (error) {
 return NextResponse.json({ error: error.message }, { status: 500 });
 }

 return NextResponse.json({ media: data }, { status: 201 });
}