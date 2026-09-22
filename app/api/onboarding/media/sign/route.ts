import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

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

// POST - valida e retorna dados para upload direto no Supabase Storage
// O frontend usa esses dados para fazer upload direto via supabase.storage
export async function POST(req: NextRequest) {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
    return NextResponse.json({ error: "Supabase não configurado" }, { status: 503 });
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  let body: {
    fileName?: string;
    fileType?: string;
    fileSize?: number;
    category?: string;
    name?: string;
  };

  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Corpo da requisição inválido." }, { status: 400 });
  }

  const { fileName, fileType, fileSize, category, name } = body;

  if (!fileName || !fileType || !fileSize || !category || !name) {
    return NextResponse.json({ error: "Campos obrigatórios: fileName, fileType, fileSize, category, name." }, { status: 400 });
  }

  if (category !== "profile_photo" && category !== "story_media") {
    return NextResponse.json({ error: "Categoria inválida (profile_photo ou story_media)." }, { status: 400 });
  }

  if (fileSize > MAX_FILE_SIZE) {
    return NextResponse.json({ error: `Arquivo muito grande (máx ${MAX_FILE_SIZE / 1024 / 1024} MB).` }, { status: 400 });
  }

  if (!ALLOWED_MIME_TYPES.has(fileType)) {
    return NextResponse.json({ error: `Tipo de arquivo não suportado: ${fileType}` }, { status: 400 });
  }

  // Gera caminho único no storage: {user_id}/{category}/{uuid}.{ext}
  const ext = fileName.split(".").pop() ?? "bin";
  const crypto = await import("crypto");
  const uuid = crypto.randomUUID();
  const storagePath = `${user.id}/${category}/${uuid}.${ext}`;

  // Retorna os dados para o frontend fazer upload direto
  return NextResponse.json({
    bucket: BUCKET,
    path: storagePath,
    contentType: fileType,
    maxSize: MAX_FILE_SIZE,
  });
}