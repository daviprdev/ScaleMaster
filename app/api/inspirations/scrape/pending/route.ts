import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET — buscas do usuário ainda rodando (para a página retomar ao voltar) e as
// que terminaram com erro nas últimas 24h (para avisar em vez de sumir).
export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });

  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await (supabase as any)
    .from("inspiration_scrape_searches")
    .select("id, username, status, reel_count, error_message, created_at, finished_at")
    .eq("user_id", user.id)
    .or(`status.eq.running,and(status.eq.error,created_at.gte.${since})`)
    .order("created_at", { ascending: false })
    .limit(20);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ searches: data ?? [] });
}
