import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { criarPastaMidia, nomePastaMidia, pastaMidias } from "@/lib/vps/midias";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// POST { nome } — cria uma pasta de mídia em /opt/scalemaster/midias (um nível, nome sanitizado). Já existir não é erro.
export async function POST(req: NextRequest) {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) return NextResponse.json({ error: "Supabase não configurado" }, { status: 503 });
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  const body = (await req.json().catch(() => null)) as { nome?: unknown } | null;
  const nome = nomePastaMidia(body?.nome);
  if (!nome) return NextResponse.json({ error: "Informe o nome da pasta (letras e números)." }, { status: 400 });
  try {
    criarPastaMidia(pastaMidias(), nome);
    return NextResponse.json({ nome });
  } catch (e) {
    return NextResponse.json({ error: `Não criei a pasta em ${pastaMidias()}: ${(e as Error).message}` }, { status: 500 });
  }
}
