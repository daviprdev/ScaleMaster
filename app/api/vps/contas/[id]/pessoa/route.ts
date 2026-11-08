import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { decrypt } from "@/lib/encrypt";
import { isMissingSchemaError } from "@/lib/queue-insights/load";
import { mascararSenha } from "@/lib/vps/pessoa";
import type { VpsContaInput } from "@/lib/vps/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// GET — a pessoa gerada para a conta (nome, @, nascimento, senha do Instagram):
// só o dono, só sob demanda (botão "Dados" do card). A senha vai inteira para o
// botão copiar e mascarada para a tela.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
    return NextResponse.json({ error: "Supabase não configurado" }, { status: 503 });
  }
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  const admin = getSupabaseAdmin();
  const { data: job, error } = await admin.from("emulator_jobs").select("id, input_enc").eq("id", id).eq("user_id", user.id).maybeSingle();
  if (isMissingSchemaError(error)) return NextResponse.json({ error: "Falta aplicar o SQL supabase/vps_contas.sql no Supabase." }, { status: 503 });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!job) return NextResponse.json({ error: "Conta não encontrada." }, { status: 404 });

  let input: VpsContaInput;
  try {
    input = JSON.parse(decrypt(job.input_enc as string)) as VpsContaInput;
  } catch {
    return NextResponse.json({ error: "Não deu para abrir os dados dessa conta." }, { status: 500 });
  }
  return NextResponse.json({
    nome: input.conta.nome,
    usuario: input.conta.usuario,
    nascimento: input.conta.nascimento,
    senha: input.conta.senha,
    senhaMascarada: mascararSenha(input.conta.senha),
  });
}
