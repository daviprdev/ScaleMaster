import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { isMissingSchemaError } from "@/lib/queue-insights/load";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// POST — conta que parou volta para a fila da VPS. O agente retoma da etapa
// que falhou (as concluídas ficam em steps e são puladas), no mesmo container.
// Conta pausada por proxy morta precisa de proxy nova (PATCH) antes.
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
    return NextResponse.json({ error: "Supabase não configurado" }, { status: 503 });
  }

  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  const admin = getSupabaseAdmin();
  const { data: atual, error: readErr } = await admin
    .from("emulator_jobs")
    .select("id, status, pausa")
    .eq("id", id)
    .eq("user_id", user.id)
    .maybeSingle();
  if (isMissingSchemaError(readErr)) {
    return NextResponse.json({ error: "Falta aplicar o SQL supabase/vps_contas.sql no Supabase." }, { status: 503 });
  }
  if (readErr) return NextResponse.json({ error: readErr.message }, { status: 500 });
  if (!atual) return NextResponse.json({ error: "Conta não encontrada." }, { status: 404 });
  if (atual.pausa === "proxy") {
    return NextResponse.json({ error: "A conta está pausada por proxy morta. Troque a proxy em Editar e salve para continuar." }, { status: 409 });
  }

  const { data, error } = await admin
    .from("emulator_jobs")
    .update({ status: "queued", error: null, finished_at: null, updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("user_id", user.id)
    .eq("status", "error")
    .select("id");

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data?.length) return NextResponse.json({ error: "Só dá para continuar uma conta que parou com erro." }, { status: 409 });
  return NextResponse.json({ ok: true });
}
