import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { isUuid } from "@/lib/managed-links";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/links/[id]/analytics?days=30
 *
 * Toda contagem é feita pela RPC `get_managed_link_analytics` (agregação
 * server-side). Nenhuma linha de `managed_link_clicks` é paginada até o
 * browser: a tabela cresce sem teto e o PostgREST corta em 1000 sem avisar.
 * A RPC devolve as séries já somadas + uma amostra fixa dos 50 cliques mais
 * recentes para a tabela do detalhe.
 *
 * IDOR: a checagem de dono está DENTRO da RPC (`WHERE id = ? AND user_id = ?`).
 * Link de outro usuário devolve NULL, e a rota converte isso em 404.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
    return NextResponse.json({ error: "Banco não configurado." }, { status: 503 });
  }

  const { id } = await params;
  if (!isUuid(id)) return NextResponse.json({ error: "Link não encontrado." }, { status: 404 });
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });

  const daysRaw = Number(new URL(req.url).searchParams.get("days") ?? 30);
  const days = Number.isFinite(daysRaw) ? Math.min(Math.max(Math.trunc(daysRaw), 1), 365) : 30;

  const { data, error } = await getSupabaseAdmin().rpc("get_managed_link_analytics", {
    p_link_id: id,
    p_user_id: user.id,
    p_days: days,
  });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "Link não encontrado." }, { status: 404 });

  return NextResponse.json({ analytics: data });
}
