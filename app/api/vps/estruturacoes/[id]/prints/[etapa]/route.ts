import { NextRequest, NextResponse } from "next/server";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { createClient } from "@/lib/supabase/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { pastaPrints } from "@/lib/vps/midias";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ETAPA_RE = /^[a-z0-9-]{1,30}$/;

// GET — print da tela que o agente tirou no fim de uma etapa (/opt/scalemaster/vps/prints/<job>/<etapa>.png).
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string; etapa: string }> }) {
  const { id, etapa } = await params;
  if (!UUID_RE.test(id) || !ETAPA_RE.test(etapa)) return NextResponse.json({ error: "Print inválido." }, { status: 400 });
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  const { data: job } = await getSupabaseAdmin().from("emulator_jobs").select("id").eq("id", id).eq("user_id", user.id).maybeSingle();
  if (!job) return NextResponse.json({ error: "Estruturação não encontrada." }, { status: 404 });
  try {
    const png = await readFile(path.join(pastaPrints(), id.toLowerCase(), `${etapa}.png`));
    return new NextResponse(new Uint8Array(png), { headers: { "Content-Type": "image/png", "Cache-Control": "private, max-age=60" } });
  } catch {
    return NextResponse.json({ error: "Sem print dessa etapa." }, { status: 404 });
  }
}
