import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getSupabaseAdmin } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST — marca avisos de busca com erro como dispensados.
 *
 * Body: { id: "<uuid>" }  ou  { all: true }
 *
 * O "X" do aviso era só estado do React: fechar sumia com a mensagem até o
 * próximo reload, e aí ela voltava — o GET /pending devolve os erros das
 * últimas 24h. Agora a dispensa é gravada em `dismissed_at`.
 *
 * Escrita pelo service_role com o dono filtrado na query, e NÃO por uma policy
 * de UPDATE para o usuário: a tabela guarda `run_ids`, `status` e
 * `processing_until`, e mexer nesses campos dispararia run pago de fallback
 * duplicado. O usuário só precisa poder apagar o próprio aviso, e é só isso
 * que esta rota escreve.
 */
export async function POST(req: NextRequest) {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
    return NextResponse.json({ error: "Supabase não configurado." }, { status: 503 });
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });

  let body: { id?: string; all?: boolean };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Corpo da requisição inválido." }, { status: 400 });
  }

  const admin = getSupabaseAdmin();
  const nowIso = new Date().toISOString();

  let query = (admin as any)
    .from("inspiration_scrape_searches")
    .update({ dismissed_at: nowIso })
    .eq("user_id", user.id)
    .eq("status", "error")
    .is("dismissed_at", null);

  if (body.all !== true) {
    if (!body.id) {
      return NextResponse.json({ error: "Informe o id do aviso ou all: true." }, { status: 400 });
    }
    query = query.eq("id", body.id);
  }

  // .select() confirma quantas linhas foram afetadas — sem ele, um filtro que
  // não casa com nada devolveria sucesso e a UI mentiria para o usuário.
  const { data, error } = await query.select("id");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ dismissed: data?.length ?? 0 });
}
