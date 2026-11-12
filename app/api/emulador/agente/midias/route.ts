import { NextRequest, NextResponse } from "next/server";
import { agenteDoPedido } from "@/lib/vps/agente-auth";
import { listarMidias, pastaMidias } from "@/lib/vps/midias";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// GET — lista das fotos de /opt/scalemaster/midias do app (caminho e tamanho),
// para o agente noutra máquina baixar o que falta (agente-vps/lib/saas.mjs).
export async function GET(req: NextRequest) {
  const quem = await agenteDoPedido(req);
  if ("response" in quem) return quem.response;
  return NextResponse.json({ files: listarMidias(pastaMidias()) });
}
