import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getSupabaseAdmin } from "@/lib/supabase";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// GET — Retorna o display_name atualizado do usuário (server-side, sem cache JWT)
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Não autenticado." }, { status: 401 });
  }

  // Usa service role para buscar metadata atualizada diretamente do servidor
  const admin = getSupabaseAdmin();
  const { data, error } = await admin.auth.admin.getUserById(user.id);

  if (error || !data?.user) {
    return NextResponse.json({ error: "Erro ao buscar perfil." }, { status: 500 });
  }

  const displayName =
    data.user.user_metadata?.display_name ||
    data.user.user_metadata?.full_name ||
    data.user.email?.split("@")[0] ||
    "";

  return NextResponse.json({ display_name: displayName });
}