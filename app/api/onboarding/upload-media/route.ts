import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getSupabaseAdmin } from "@/lib/supabase";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

const ALLOWED_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "video/mp4",
  "video/quicktime",
];
const MAX_SIZE_BYTES = 50 * 1024 * 1024; // 50 MB

/**
 * POST /api/onboarding/upload-media
 * Recebe um arquivo (foto de perfil ou mídia de story) via multipart/form-data
 * e salva no bucket "onboarding" do Supabase Storage.
 * Retorna a URL pública do arquivo.
 * Auth: sessão Supabase do usuário logado.
 */
export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  }

  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return NextResponse.json({ error: "FormData inválido" }, { status: 400 });
  }

  const file = formData.get("file") as File | null;
  const path = formData.get("path") as string | null;

  if (!file || !path) {
    return NextResponse.json(
      { error: "file e path são obrigatórios" },
      { status: 400 }
    );
  }

  if (!ALLOWED_TYPES.includes(file.type)) {
    return NextResponse.json(
      { error: `Tipo de arquivo não permitido: ${file.type}` },
      { status: 400 }
    );
  }

  if (file.size > MAX_SIZE_BYTES) {
    return NextResponse.json(
      { error: `Arquivo muito grande (máx ${MAX_SIZE_BYTES / 1024 / 1024}MB)` },
      { status: 400 }
    );
  }

  // Sanitizar path — garantir que começa com onboarding/ e não contém ..
  const safePath = path.replace(/\.\./g, "").replace(/^\/+/, "");
  if (!safePath.startsWith("onboarding/")) {
    return NextResponse.json(
      { error: "Path deve começar com onboarding/" },
      { status: 400 }
    );
  }

  const admin = getSupabaseAdmin();
  const bucket = process.env.ONBOARDING_STORAGE_BUCKET ?? "onboarding";

  // Converter File para Buffer
  const arrayBuffer = await file.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  const { error: uploadError } = await admin.storage
    .from(bucket)
    .upload(safePath, buffer, {
      contentType: file.type,
      upsert: true,
    });

  if (uploadError) {
    console.error("[onboarding/upload-media] upload error:", uploadError.message);
    return NextResponse.json(
      { error: `Erro ao salvar arquivo: ${uploadError.message}` },
      { status: 500 }
    );
  }

  // Gerar URL pública
  const { data: urlData } = admin.storage
    .from(bucket)
    .getPublicUrl(safePath);

  if (!urlData?.publicUrl) {
    return NextResponse.json(
      { error: "Erro ao gerar URL pública" },
      { status: 500 }
    );
  }

  console.log(`[onboarding/upload-media] ✅ ${safePath} (${file.size} bytes) → ${urlData.publicUrl.slice(0, 100)}`);

  return NextResponse.json({ url: urlData.publicUrl });
}