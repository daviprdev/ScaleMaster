import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { advanceSearch } from "@/lib/inspiration-scrape";

export const runtime = "nodejs";
export const maxDuration = 60;

// GET ?searchId= — acompanha uma busca de Inspirações. O avanço (e o salvamento
// no histórico) é feito por advanceSearch, o MESMO código do cron: se a página
// fechar no meio, o cron termina e o perfil aparece no histórico.
export async function GET(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });

  const searchId = new URL(req.url).searchParams.get("searchId");
  if (!searchId) {
    return NextResponse.json({ error: "searchId obrigatório." }, { status: 400 });
  }

  const admin = getSupabaseAdmin();

  // Dono da busca.
  const { data: owned } = await (admin as any)
    .from("inspiration_scrape_searches")
    .select("id")
    .eq("id", searchId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!owned) return NextResponse.json({ error: "Busca não encontrada." }, { status: 404 });

  const result = await advanceSearch(admin, searchId);

  if (result.status === "error") {
    return NextResponse.json({ status: "error", error: result.error }, { status: 404 });
  }
  return NextResponse.json(result);
}
