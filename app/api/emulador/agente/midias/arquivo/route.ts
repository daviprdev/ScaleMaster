import { readFileSync } from "node:fs";
import path from "node:path";
import { NextRequest, NextResponse } from "next/server";
import { agenteDoPedido } from "@/lib/vps/agente-auth";
import { listarMidias, pastaMidias } from "@/lib/vps/midias";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const TIPO: Record<string, string> = { ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp" };

// GET ?path=perfil/foto.jpg — os bytes de uma foto da pasta de mídias. Só sai
// o que está na listagem (nada de caminho montado à mão: "..", absoluto etc.).
export async function GET(req: NextRequest) {
  const quem = await agenteDoPedido(req);
  if ("response" in quem) return quem.response;
  const rel = req.nextUrl.searchParams.get("path") ?? "";
  const raiz = pastaMidias();
  if (!listarMidias(raiz).some((m) => m.path === rel)) return NextResponse.json({ error: "Foto não encontrada." }, { status: 404 });
  const arquivo = path.resolve(raiz, rel);
  if (!arquivo.startsWith(path.resolve(raiz) + path.sep)) return NextResponse.json({ error: "Caminho inválido." }, { status: 400 });
  try {
    const bytes = readFileSync(arquivo);
    return new NextResponse(new Uint8Array(bytes), {
      headers: { "Content-Type": TIPO[path.extname(arquivo).toLowerCase()] ?? "application/octet-stream", "Content-Length": String(bytes.length), "Cache-Control": "no-store" },
    });
  } catch {
    return NextResponse.json({ error: "Não deu para ler a foto." }, { status: 500 });
  }
}
