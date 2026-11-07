import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getSupabaseAdmin } from "@/lib/supabase";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// DELETE — desconecta a VPS. O código dela para de valer na hora (o agente
// passa a levar 401); comandos, contas e devices vão junto (on delete cascade).
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
    return NextResponse.json({ error: "Supabase não configurado" }, { status: 503 });
  }

  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  const { data, error } = await getSupabaseAdmin()
    .from("emulator_agents")
    .delete()
    .eq("id", id)
    .eq("user_id", user.id)
    .eq("kind", "vps")
    .select("id");

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data?.length) return NextResponse.json({ error: "VPS não encontrada." }, { status: 404 });
  return NextResponse.json({ ok: true });
}
