import { readFileSync } from "node:fs";
import path from "node:path";
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { listarMidias, pastaMidias } from "@/lib/vps/midias";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const TIPO: Record<string, string> = { ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp" };

// GET ?path=pasta/foto.jpg — a foto para as miniaturas do Mídias e do Estruturar (dono logado).
// Só sai o que está na listagem: nada de caminho montado à mão ("..", absoluto etc.).
export async function GET(req: NextRequest) {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) return NextResponse.json({ error: "Supabase não configurado" }, { status: 503 });
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  const rel = req.nextUrl.searchParams.get("path") ?? "";
  const raiz = pastaMidias();
  if (!listarMidias(raiz).some((m) => m.path === rel)) return NextResponse.json({ error: "Foto não encontrada." }, { status: 404 });
  const arquivo = path.resolve(raiz, rel);
  if (!arquivo.startsWith(path.resolve(raiz) + path.sep)) return NextResponse.json({ error: "Caminho inválido." }, { status: 400 });
  try {
    const bytes = readFileSync(arquivo);
    return new NextResponse(new Uint8Array(bytes), {
      headers: {
        "Content-Type": TIPO[path.extname(arquivo).toLowerCase()] ?? "application/octet-stream",
        "Content-Length": String(bytes.length),
        // O nome não se repete (o upload nunca sobrescreve): pode ficar no cache do navegador.
        "Cache-Control": "private, max-age=86400",
      },
    });
  } catch {
    return NextResponse.json({ error: "Não deu para ler a foto." }, { status: 500 });
  }
}
