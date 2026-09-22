import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { isUuid } from "@/lib/managed-links";

export const dynamic = "force-dynamic";

const BUCKET = "onboarding-media";

// DELETE - remove uma mídia da biblioteca (banco + storage)
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
    return NextResponse.json({ error: "Supabase não configurado" }, { status: 503 });
  }

  const { id } = await params;
  if (!isUuid(id)) return NextResponse.json({ error: "id inválido" }, { status: 400 });

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  const admin = getSupabaseAdmin();

  // Busca o registro para obter o storage_path
  const { data: media, error: fetchErr } = await admin
    .from("onboarding_media_library")
    .select("id, storage_path")
    .eq("id", id)
    .eq("user_id", user.id)
    .maybeSingle();

  if (fetchErr) return NextResponse.json({ error: fetchErr.message }, { status: 500 });
  if (!media) return NextResponse.json({ error: "Mídia não encontrada." }, { status: 404 });

  // Remove do banco primeiro
  const { error: deleteErr } = await admin
    .from("onboarding_media_library")
    .delete()
    .eq("id", id)
    .eq("user_id", user.id);

  if (deleteErr) return NextResponse.json({ error: deleteErr.message }, { status: 500 });

  // Remove do storage (best-effort, não falha se o arquivo já não existir)
  try {
    await admin.storage.from(BUCKET).remove([media.storage_path]);
  } catch (e) {
    console.warn("[onboarding-media] Storage remove warning:", e);
  }

  return NextResponse.json({ success: true });
}