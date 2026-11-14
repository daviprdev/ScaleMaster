import path from "node:path";
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { MIDIA_MAX_BYTES } from "@/lib/vps/estruturacao";
import { apagarMidia, listarMidias, pastaMidiaFixa, pastaMidias, pastasFixasDeMidia, salvarMidia } from "@/lib/vps/midias";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const SEM_ARQUIVO = 'Envie a foto no campo "arquivo".';

async function usuario() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  return user;
}

// GET — fotos de /opt/scalemaster/midias (a pasta que o agente da VPS usa) e as duas pastas fixas (Foto Perfil e Stories).
export async function GET() {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) return NextResponse.json({ error: "Supabase não configurado" }, { status: 503 });
  if (!(await usuario())) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  const files = listarMidias(pastaMidias());
  return NextResponse.json({ root: pastaMidias(), files, folders: pastasFixasDeMidia(pastaMidias(), files) });
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
    // pasta=perfil (Foto Perfil: o agente sorteia só de midias/perfil/) ou stories (fotos do story). Só essas duas.
    subpasta = pastaMidiaFixa(form.get("pasta")) ?? "";
  } catch {
    return NextResponse.json({ error: SEM_ARQUIVO }, { status: 400 });
  }
  if (!arquivo || typeof arquivo === "string") return NextResponse.json({ error: SEM_ARQUIVO }, { status: 400 });
  if (!subpasta) return NextResponse.json({ error: "Escolha a pasta: Foto Perfil ou Stories." }, { status: 400 });
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

// DELETE ?path=pasta/foto.jpg — apaga a foto (Mídias → Excluir). O agente apaga a cópia dele no próximo sync.
export async function DELETE(req: NextRequest) {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) return NextResponse.json({ error: "Supabase não configurado" }, { status: 503 });
  if (!(await usuario())) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  const rel = req.nextUrl.searchParams.get("path") ?? "";
  try {
    const r = apagarMidia(pastaMidias(), rel);
    if ("error" in r) return NextResponse.json({ error: r.error }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: `Não apaguei a foto: ${(e as Error).message}` }, { status: 500 });
  }
}
