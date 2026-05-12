import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

const BUCKET = "avatars";
const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp"];
const MAX_BYTES = 5 * 1024 * 1024; // 5 MB

export async function POST(req: NextRequest) {
  // Autenticar via cookie de sessão
  const supabaseUser = await createClient();
  const { data: { user } } = await supabaseUser.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Não autenticado." }, { status: 401 });
  }

  // Parse multipart/form-data
  const formData = await req.formData();
  const file = formData.get("avatar") as File | null;
  if (!file) {
    return NextResponse.json({ error: "Arquivo não enviado." }, { status: 400 });
  }

  // Validações de tipo e tamanho
  if (!ALLOWED_TYPES.includes(file.type)) {
    return NextResponse.json(
      { error: "Tipo inválido. Use JPG, PNG ou WebP." },
      { status: 400 }
    );
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json(
      { error: "Arquivo muito grande. Máximo 5 MB." },
      { status: 400 }
    );
  }

  const admin = getSupabaseAdmin();

  // Criar bucket se ainda não existir (ignora erro de conflito)
  await admin.storage.createBucket(BUCKET, {
    public: true,
    allowedMimeTypes: ALLOWED_TYPES,
    fileSizeLimit: MAX_BYTES,
  });

  // Upload — substitui avatar anterior com upsert
  const ext = file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : "jpg";
  const storagePath = `${user.id}/avatar.${ext}`;
  const buffer = Buffer.from(await file.arrayBuffer());

  const { error: uploadError } = await admin.storage
    .from(BUCKET)
    .upload(storagePath, buffer, { contentType: file.type, upsert: true });

  if (uploadError) {
    return NextResponse.json({ error: uploadError.message }, { status: 500 });
  }

  // URL pública com cache-bust para o browser não servir a foto antiga
  const { data: { publicUrl } } = admin.storage.from(BUCKET).getPublicUrl(storagePath);
  const avatarUrl = `${publicUrl}?t=${Date.now()}`;

  // Salvar avatar_url no user_metadata via admin (sem precisar reautenticar)
  const { error: metaError } = await admin.auth.admin.updateUserById(user.id, {
    user_metadata: { ...user.user_metadata, avatar_url: avatarUrl },
  });

  if (metaError) {
    return NextResponse.json({ error: metaError.message }, { status: 500 });
  }

  return NextResponse.json({ url: avatarUrl });
}
