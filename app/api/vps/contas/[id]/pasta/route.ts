import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { isMissingSchemaError } from "@/lib/queue-insights/load";
import { FALTA_SQL_PASTAS, normalizarPasta } from "@/lib/vps/pastas";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// POST { pasta } — move a conta (job nova-conta) para a pasta; "" = sem pasta.
// Só muda a etiqueta: nada na VPS é tocado.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) return NextResponse.json({ error: "Supabase não configurado" }, { status: 503 });
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  const body = (await req.json().catch(() => null)) as { pasta?: unknown } | null;
  if (!body) return NextResponse.json({ error: "Corpo da requisição inválido." }, { status: 400 });
  const pasta = normalizarPasta(body.pasta);

  const admin = getSupabaseAdmin();
  const { data, error } = await admin
    .from("emulator_jobs")
    .update({ pasta })
    .eq("id", id)
    .eq("user_id", user.id)
    .eq("kind", "nova-conta")
    .select("id");
  if (isMissingSchemaError(error)) return NextResponse.json({ error: FALTA_SQL_PASTAS }, { status: 503 });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data?.length) return NextResponse.json({ error: "Conta não encontrada." }, { status: 404 });
  return NextResponse.json({ pasta });
}
