import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getSupabaseAdmin } from "@/lib/supabase";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// POST — responde o que o agente pediu no meio da criação da conta: o código
// que chegou no Gmail ou "continuar" depois de o dono resolver uma tela na
// instância. O agente recebe no próximo sync (~3 s).
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
    return NextResponse.json({ error: "Supabase não configurado" }, { status: 503 });
  }

  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  let resposta: unknown;
  try {
    resposta = ((await req.json()) as { resposta?: unknown }).resposta;
  } catch {
    return NextResponse.json({ error: "Corpo da requisição inválido." }, { status: 400 });
  }
  const text = typeof resposta === "string" ? resposta.trim() : "";
  if (!text || text.length > 40 || /[^\x20-\x7E]/.test(text)) {
    return NextResponse.json({ error: "Resposta inválida." }, { status: 400 });
  }

  const { data, error } = await getSupabaseAdmin()
    .from("emulator_jobs")
    .update({ reply: text, updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("user_id", user.id)
    .eq("status", "running")
    .not("prompt", "is", null)
    .select("id");

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data?.length) return NextResponse.json({ error: "Essa conta não está esperando resposta." }, { status: 409 });
  return NextResponse.json({ ok: true });
}
