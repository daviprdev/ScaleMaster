import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getSupabaseAdmin } from "@/lib/supabase";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// DELETE — tira a conta da lista (e da fila, se ainda não começou). A
// instância criada no MuMu fica lá; apagar instância é com o dono no MuMu.
export async function DELETE(
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

  const { data, error } = await getSupabaseAdmin()
    .from("emulator_jobs")
    .delete()
    .eq("id", id)
    .eq("user_id", user.id)
    .neq("status", "running")
    .select("id");

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data?.length) {
    return NextResponse.json({ error: "Conta não encontrada ou rodando agora (espere terminar ou falhar)." }, { status: 409 });
  }
  return NextResponse.json({ ok: true });
}
