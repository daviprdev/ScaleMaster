import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { MIDIA_MAX_BYTES } from "@/lib/vps/estruturacao";
import { listarMidias, pastaMidias, salvarMidia } from "@/lib/vps/midias";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const SEM_ARQUIVO = 'Envie a foto no campo "arquivo".';

async function usuario() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  return user;
}

// GET — fotos de /opt/scalemaster/midias (a pasta que o agente da VPS usa), para os selects do Estruturar.
export async function GET() {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) return NextResponse.json({ error: "Supabase não configurado" }, { status: 503 });
  if (!(await usuario())) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  return NextResponse.json({ root: pastaMidias(), files: listarMidias(pastaMidias()) });
}

// POST — upload de uma foto (multipart, campo "arquivo"): até 8 MB, jpg/png/webp, nome sanitizado, sem sobrescrever.
export async function POST(req: NextRequest) {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) return NextResponse.json({ error: "Supabase não configurado" }, { status: 503 });
  if (!(await usuario())) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  if (Number(req.headers.get("content-length") ?? 0) > MIDIA_MAX_BYTES + 64 * 1024) {
    return NextResponse.json({ error: "A foto passa de 8 MB." }, { status: 413 });
  }
  let arquivo: FormDataEntryValue | null;
  try {
    arquivo = (await req.formData()).get("arquivo");
  } catch {
    return NextResponse.json({ error: SEM_ARQUIVO }, { status: 400 });
  }
  if (!arquivo || typeof arquivo === "string") return NextResponse.json({ error: SEM_ARQUIVO }, { status: 400 });
  if (arquivo.size > MIDIA_MAX_BYTES) return NextResponse.json({ error: "A foto passa de 8 MB." }, { status: 413 });

  try {
    const salvo = salvarMidia(pastaMidias(), arquivo.name, new Uint8Array(await arquivo.arrayBuffer()));
    if ("error" in salvo) return NextResponse.json({ error: salvo.error }, { status: 400 });
    return NextResponse.json({ path: salvo.path });
  } catch (e) {
    return NextResponse.json({ error: `Não gravei em ${pastaMidias()}: ${(e as Error).message}` }, { status: 500 });
  }
}
