import path from "node:path";
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { MIDIA_MAX_BYTES } from "@/lib/vps/estruturacao";
import { listarMidias, nomePastaMidia, pastaMidias, pastasDeMidia, salvarMidia } from "@/lib/vps/midias";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const SEM_ARQUIVO = 'Envie a foto no campo "arquivo".';

async function usuario() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  return user;
}

// GET — fotos de /opt/scalemaster/midias (a pasta que o agente da VPS usa) e as pastas de primeiro nível (Mídias / Estruturar).
export async function GET() {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) return NextResponse.json({ error: "Supabase não configurado" }, { status: 503 });
  if (!(await usuario())) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  const files = listarMidias(pastaMidias());
  return NextResponse.json({ root: pastaMidias(), files, folders: pastasDeMidia(pastaMidias(), files) });
}

// POST — upload de uma foto (multipart, campo "arquivo"): até 8 MB, jpg/png/webp, nome sanitizado, sem sobrescrever.
export async function POST(req: NextRequest) {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) return NextResponse.json({ error: "Supabase não configurado" }, { status: 503 });
  if (!(await usuario())) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  if (Number(req.headers.get("content-length") ?? 0) > MIDIA_MAX_BYTES + 64 * 1024) {
    return NextResponse.json({ error: "A foto passa de 8 MB." }, { status: 413 });
  }
  let arquivo: FormDataEntryValue | null;
  let subpasta = "";
  try {
    const form = await req.formData();
    arquivo = form.get("arquivo");
    // pasta=perfil: foto de perfil da criação de conta (o agente sorteia só de midias/perfil/); outra = pasta do diálogo Mídias.
    subpasta = nomePastaMidia(form.get("pasta")) ?? "";
  } catch {
    return NextResponse.json({ error: SEM_ARQUIVO }, { status: 400 });
  }
  if (!arquivo || typeof arquivo === "string") return NextResponse.json({ error: SEM_ARQUIVO }, { status: 400 });
  if (arquivo.size > MIDIA_MAX_BYTES) return NextResponse.json({ error: "A foto passa de 8 MB." }, { status: 413 });

  try {
    const raiz = subpasta ? path.join(pastaMidias(), subpasta) : pastaMidias();
    const salvo = salvarMidia(raiz, arquivo.name, new Uint8Array(await arquivo.arrayBuffer()));
    if ("error" in salvo) return NextResponse.json({ error: salvo.error }, { status: 400 });
    return NextResponse.json({ path: subpasta ? `${subpasta}/${salvo.path}` : salvo.path });
  } catch (e) {
    return NextResponse.json({ error: `Não gravei em ${pastaMidias()}: ${(e as Error).message}` }, { status: 500 });
  }
}
