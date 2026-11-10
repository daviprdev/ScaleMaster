import { NextRequest, NextResponse } from "next/server";
import { rmSync } from "node:fs";
import path from "node:path";
import { createClient } from "@/lib/supabase/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { pastaPrints } from "@/lib/vps/midias";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function usuario() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  return user;
}

// POST — Continuar: a estruturação parada volta para a fila agora (sem agenda). As etapas
// concluídas ficam; as que falharam ou foram puladas rodam de novo.
export async function POST(_req: NextRequest, { params }: Params) {
  const { id } = await params;
  const user = await usuario();
  if (!user) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  const admin = getSupabaseAdmin();
  const { data, error } = await admin
    .from("emulator_jobs")
    .update({ status: "queued", error: null, finished_at: null, agendado_para: null, updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("user_id", user.id)
    .eq("kind", "estruturacao")
    .eq("status", "error")
    .select("id");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data?.length) return NextResponse.json({ error: "Só dá para continuar uma estruturação que parou." }, { status: 409 });
  return NextResponse.json({ ok: true });
}

// DELETE — tira a estruturação da conta (o container e a conta ficam como estão).
export async function DELETE(_req: NextRequest, { params }: Params) {
  const { id } = await params;
  const user = await usuario();
  if (!user) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  const admin = getSupabaseAdmin();
  const { data, error } = await admin
    .from("emulator_jobs")
    .delete()
    .eq("id", id)
    .eq("user_id", user.id)
    .eq("kind", "estruturacao")
    .neq("status", "running")
    .select("id");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data?.length) return NextResponse.json({ error: "Estruturação não encontrada ou rodando agora." }, { status: 409 });
  // Prints do job: o app monta a pasta só para leitura; se não der para apagar, o agente limpa os antigos.
  if (UUID_RE.test(id)) {
    try {
      rmSync(path.join(pastaPrints(), id.toLowerCase()), { recursive: true, force: true });
    } catch {
      /* pasta só leitura */
    }
  }
  return NextResponse.json({ ok: true });
}
