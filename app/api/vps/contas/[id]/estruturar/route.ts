import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { parseEstrutura } from "@/lib/vps/estruturacao";
import { CONTA_COLUNAS, criarEstruturacao, type ContaRow } from "@/lib/vps/estruturar-conta";
import { listarMidias, pastaMidias } from "@/lib/vps/midias";
import { normalizarPasta } from "@/lib/vps/pastas";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// POST — "Estruturar" numa conta já criada: põe na fila da VPS um job
// kind = 'estruturacao' no container da conta, com as etapas expandidas por
// alvo (acoes) e o resto criptografado (input_enc). Falha dele nunca mexe no
// status da conta: é outra linha da fila. A pasta inteira vai por /api/vps/pastas/estruturar.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) return NextResponse.json({ error: "Supabase não configurado" }, { status: 503 });
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Corpo da requisição inválido." }, { status: 400 });
  }
  const parsed = parseEstrutura(body, listarMidias(pastaMidias()).map((m) => m.path));
  if ("error" in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 });

  const admin = getSupabaseAdmin();
  const { data: conta, error: contaErr } = await admin.from("emulator_jobs").select(CONTA_COLUNAS).eq("id", id).eq("user_id", user.id).maybeSingle();
  if (contaErr) return NextResponse.json({ error: contaErr.message }, { status: 500 });
  if (!conta) return NextResponse.json({ error: "Conta não encontrada." }, { status: 404 });

  const pastaDestino = normalizarPasta((body as Record<string, unknown> | null)?.pastaDestino);
  const r = await criarEstruturacao(admin, user.id, conta as unknown as ContaRow, parsed.value, { pastaDestino });
  if ("error" in r) return NextResponse.json({ error: r.error }, { status: r.status });
  return NextResponse.json(r);
}
