import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import {
  STORY_MAX_IMAGE_SIZE as MAX_IMAGE_SIZE,
  STORY_MAX_VIDEO_SIZE as MAX_VIDEO_SIZE,
  STORY_VALID_TYPES as VALID_TYPES,
} from "@/lib/story-upload";

export const runtime = "nodejs";

// Segunda etapa do upload de Story: o arquivo já está no Storage (enviado
// direto pelo navegador). Aqui confirmamos que ele existe, pertence ao usuário
// e respeita tipo/tamanho — usando os metadados do PRÓPRIO Storage, não o que
// o cliente declarou — e só então registramos na biblioteca de Stories.

const PATH_RE = /^stories\/[0-9a-f-]{36}\/[0-9a-f-]{36}\.(mp4|jpg|png)$/;

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });

  let body: { storage_path?: string; filename?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Requisição inválida." }, { status: 400 });
  }

  const storagePath = String(body.storage_path ?? "");
  if (!PATH_RE.test(storagePath) || !storagePath.startsWith(`stories/${user.id}/`)) {
    return NextResponse.json({ error: "Caminho de arquivo inválido." }, { status: 400 });
  }

  const admin = getSupabaseAdmin();
  const folder = `stories/${user.id}`;
  const name = storagePath.slice(folder.length + 1);

  const { data: listed, error: listErr } = await admin.storage
    .from("videos-library")
    .list(folder, { search: name, limit: 5 });

  if (listErr) {
    return NextResponse.json({ error: `Falha ao confirmar upload: ${listErr.message}` }, { status: 500 });
  }

  const obj = listed?.find(o => o.name === name);
  if (!obj) {
    return NextResponse.json({ error: "Arquivo não encontrado no Storage. Tente enviar de novo." }, { status: 404 });
  }

  const meta = (obj.metadata ?? {}) as { size?: number; mimetype?: string };
  const mimetype = String(meta.mimetype ?? "");
  const size = Number(meta.size ?? 0);
  const isImage = mimetype.startsWith("image/");
  const maxSize = isImage ? MAX_IMAGE_SIZE : MAX_VIDEO_SIZE;

  if (!VALID_TYPES.includes(mimetype) || size <= 0 || size > maxSize) {
    await admin.storage.from("videos-library").remove([storagePath]);
    return NextResponse.json({ error: "Arquivo rejeitado (tipo ou tamanho inválido)." }, { status: 400 });
  }

  const { data: urlData } = admin.storage.from("videos-library").getPublicUrl(storagePath);
  const mediaType = isImage ? "image" : "video";

  // Registro na biblioteca de Stories é best-effort: falhar aqui não impede
  // a postagem, só impede reusar o arquivo depois.
  let mediaId: string | null = null;
  const { data: mediaRow, error: mediaErr } = await admin
    .from("story_media")
    .upsert(
      {
        user_id: user.id,
        storage_path: storagePath,
        public_url: urlData.publicUrl,
        media_type: mediaType,
      },
      { onConflict: "user_id,storage_path", ignoreDuplicates: false }
    )
    .select("id")
    .single();
  if (mediaErr) console.error("[stories/upload/complete] erro ao salvar na biblioteca:", mediaErr.message);
  else mediaId = mediaRow?.id ?? null;

  return NextResponse.json({
    url: urlData.publicUrl,
    media_type: mediaType,
    filename: body.filename ?? name,
    storage_path: storagePath,
    size,
    media_id: mediaId,
  });
}
