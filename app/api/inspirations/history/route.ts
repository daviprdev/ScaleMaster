import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getSupabaseAdmin } from "@/lib/supabase";

export const runtime = "nodejs";

export async function GET() {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
    console.log("[history] Supabase não configurado — retornando [].");
    return NextResponse.json({ profiles: [] });
  }

  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError) {
    console.error("[history] Erro de autenticação:", authError.message);
    return NextResponse.json({ error: authError.message }, { status: 401 });
  }

  if (!user) {
    console.warn("[history] GET chamado sem usuário autenticado.");
    return NextResponse.json({ error: "Não autenticado." }, { status: 401 });
  }

  console.log(`[history] GET para user ${user.id}`);

  const admin = getSupabaseAdmin();
  const { data, error } = await admin
    .from("scraped_profiles")
    .select("id, username, full_name, profile_pic_url, video_count, scraped_at, videos_data")
    .eq("user_id", user.id)
    .order("scraped_at", { ascending: false });

  if (error) {
    console.error(
      `[history] Erro na query — code: ${error.code}, message: ${error.message}, hint: ${error.hint ?? "—"}`
    );
    if (error.code === "42P01") {
      console.error(
        "[history] TABELA scraped_profiles NÃO EXISTE. Execute o SQL da Fase 22 no Supabase Dashboard."
      );
      // Retorna array vazio (sem 500) para não travar a UI
      return NextResponse.json({ profiles: [] });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  console.log(`[history] ${data?.length ?? 0} perfis encontrados para user ${user.id}`);
  return NextResponse.json({ profiles: data ?? [] });
}
