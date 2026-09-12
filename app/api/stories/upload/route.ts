import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { createClient } from "@/lib/supabase/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { STORY_MAX_IMAGE_SIZE, STORY_MAX_VIDEO_SIZE, STORY_VALID_TYPES } from "@/lib/story-upload";

export const runtime = "nodejs";

// O arquivo NÃO passa por esta função: a Vercel corta o corpo da requisição
// em 4,5 MB (413 FUNCTION_PAYLOAD_TOO_LARGE), o que derrubava todo upload de
// vídeo. Esta rota só emite uma URL de upload assinada para um caminho que o
// SERVIDOR escolhe; o navegador envia os bytes direto ao Supabase Storage e
// depois chama /api/stories/upload/complete para validar e registrar.

const VALID_TYPES = STORY_VALID_TYPES;
const MAX_IMAGE_SIZE = STORY_MAX_IMAGE_SIZE;
const MAX_VIDEO_SIZE = STORY_MAX_VIDEO_SIZE;

export async function POST(req: NextRequest) {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
    return NextResponse.json({ error: "Storage não configurado." }, { status: 500 });
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });

  let body: { type?: string; size?: number };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Requisição inválida." }, { status: 400 });
  }

  const type = String(body.type ?? "");
  const size = Number(body.size ?? 0);

  if (!VALID_TYPES.includes(type)) {
    return NextResponse.json({ error: `Tipo inválido: ${type || "desconhecido"}. Use JPG, PNG ou MP4.` }, { status: 400 });
  }

  const isImage = type.startsWith("image/");
  const maxSize = isImage ? MAX_IMAGE_SIZE : MAX_VIDEO_SIZE;
  if (!Number.isFinite(size) || size <= 0 || size > maxSize) {
    return NextResponse.json({
      error: `Arquivo muito grande (${(size / 1024 / 1024).toFixed(1)} MB). Máximo: ${maxSize / 1024 / 1024} MB.`,
    }, { status: 400 });
  }

  const ext = type === "image/png" ? ".png" : isImage ? ".jpg" : ".mp4";
  const storagePath = `stories/${user.id}/${randomUUID()}${ext}`;

  const admin = getSupabaseAdmin();
  const { data, error } = await admin.storage
    .from("videos-library")
    .createSignedUploadUrl(storagePath);

  if (error || !data) {
    return NextResponse.json({ error: `Falha ao preparar upload: ${error?.message ?? "sem resposta"}` }, { status: 500 });
  }

  return NextResponse.json({ storage_path: storagePath, token: data.token });
}
