import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { isMissingSchemaError } from "@/lib/queue-insights/load";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// POST — "Pausar proxy": a conta sai da fila (ou fica parada) marcada com
// pausa = 'proxy' até o dono trocar a proxy em Editar. Mandar { pausar: false }
// tira a pausa de uma conta parada sem trocar a proxy.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
    return NextResponse.json({ error: "Supabase não configurado" }, { status: 503 });
  }

  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  let pausar = true;
  try {
    const body = (await req.json().catch(() => ({}))) as { pausar?: unknown };
    if (body.pausar === false) pausar = false;
  } catch {
    /* corpo vazio = pausar */
  }

  const admin = getSupabaseAdmin();
  const now = new Date().toISOString();
  const { data, error } = pausar
    ? await admin
        .from("emulator_jobs")
        .update({ status: "error", error: "Pausada: proxy marcada como morta pelo dono.", pausa: "proxy", finished_at: now, updated_at: now })
        .eq("id", id)
        .eq("user_id", user.id)
        .in("status", ["queued", "error"])
        .select("id")
    : await admin
        .from("emulator_jobs")
        .update({ pausa: null, updated_at: now })
        .eq("id", id)
        .eq("user_id", user.id)
        .eq("pausa", "proxy")
        .select("id");

  if (isMissingSchemaError(error)) {
    return NextResponse.json({ error: "Falta aplicar o SQL supabase/vps_contas.sql no Supabase." }, { status: 503 });
  }
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data?.length) {
    return NextResponse.json({ error: pausar ? "Só dá para pausar uma conta na fila ou parada." : "Essa conta não está pausada." }, { status: 409 });
  }
  if (pausar) await admin.from("vps_devices").update({ status: "proxy-morta" }).eq("job_id", id).eq("user_id", user.id);
  return NextResponse.json({ ok: true });
}
