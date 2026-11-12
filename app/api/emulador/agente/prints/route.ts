import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { agenteDoPedido } from "@/lib/vps/agente-auth";
import { caminhoDoPrint, pastaPrints } from "@/lib/vps/midias";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_BYTES = 10 * 1024 * 1024;
const PNG = [0x89, 0x50, 0x4e, 0x47];

// POST ?job=<id>&etapa=<chave> com o PNG no corpo — print do fim da etapa do
// Estruturar mandado pelo agente (que pode estar noutra máquina). Grava em
// /opt/scalemaster/vps/prints/<job>/<etapa>.png, onde o card lê.
export async function POST(req: NextRequest) {
  const quem = await agenteDoPedido(req);
  if ("response" in quem) return quem.response;
  const job = req.nextUrl.searchParams.get("job") ?? "";
  const etapa = req.nextUrl.searchParams.get("etapa") ?? "";
  const arquivo = caminhoDoPrint(pastaPrints(), job, etapa);
  if (!arquivo) return NextResponse.json({ error: "job ou etapa inválidos." }, { status: 400 });

  // Só job deste agente.
  const { data: dono, error } = await getSupabaseAdmin().from("emulator_jobs").select("id").eq("id", job).eq("agent_id", quem.agent.id).maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!dono) return NextResponse.json({ error: "Job não encontrado." }, { status: 404 });

  const bytes = new Uint8Array(await req.arrayBuffer());
  if (bytes.length === 0 || bytes.length > MAX_BYTES) return NextResponse.json({ error: "Print vazio ou grande demais." }, { status: 413 });
  if (!PNG.every((b, i) => bytes[i] === b)) return NextResponse.json({ error: "O print precisa ser PNG." }, { status: 415 });
  try {
    mkdirSync(path.dirname(arquivo), { recursive: true });
    writeFileSync(arquivo, bytes);
  } catch (e) {
    return NextResponse.json({ error: `Não gravei o print: ${(e as Error).message}` }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
