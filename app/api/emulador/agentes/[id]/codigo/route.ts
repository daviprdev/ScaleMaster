import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { hashAgentToken, newAgentToken } from "@/lib/emulador/token";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// POST — código novo para um PC que já está na aba (o config.json dele se
// perdeu). O PC continua o mesmo: instâncias, contas e fila ficam. O código
// antigo para de valer na hora e o novo aparece UMA vez (o banco guarda só o hash).
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
    return NextResponse.json({ error: "Supabase não configurado" }, { status: 503 });
  }

  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  const token = newAgentToken();
  const { data, error } = await getSupabaseAdmin()
    .from("emulator_agents")
    .update({ token_hash: hashAgentToken(token) })
    .eq("id", id)
    .eq("user_id", user.id)
    .select("id");

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data?.length) return NextResponse.json({ error: "PC não encontrado." }, { status: 404 });
  return NextResponse.json({ id, token });
}
