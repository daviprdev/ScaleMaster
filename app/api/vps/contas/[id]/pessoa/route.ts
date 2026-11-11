import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { decrypt } from "@/lib/encrypt";
import { isMissingSchemaError } from "@/lib/queue-insights/load";
import { mascararSenha } from "@/lib/vps/pessoa";
import { parsePlano, resultadoPorAlvo, resumoDosAlvos, type EstruturaInput } from "@/lib/vps/estruturacao";
import { parseJobSteps } from "@/lib/emulador/jobs";
import type { VpsContaInput } from "@/lib/vps/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// GET — bloco "Informações" do card: a pessoa gerada para a conta (nome, @,
// nascimento, senha do Instagram) e, se houver, a estruturação mais nova (bio,
// alvos configurados, data e resultado por alvo). Só o dono, só sob demanda.
// A senha vai inteira para o botão copiar e mascarada para a tela.
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
  // Estruturação mais nova da conta (sem o SQL do Estruturar a coluna conta_id não existe: segue sem ela).
  let estruturacao: Record<string, unknown> | null = null;
  const { data: est } = await admin
    .from("emulator_jobs")
    .select("id, status, steps, acoes, input_enc, created_at, updated_at, agendado_para")
    .eq("conta_id", id)
    .eq("user_id", user.id)
    .eq("kind", "estruturacao")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (est) {
    let dados: Partial<EstruturaInput> = {};
    try {
      dados = JSON.parse(decrypt(est.input_enc as string)) as EstruturaInput;
    } catch {
      /* sem os dados: mostra só o resultado */
    }
    const resultados = resultadoPorAlvo(parsePlano(est.acoes), parseJobSteps(est.steps));
    estruturacao = {
      id: est.id,
      status: est.status,
      criadaEm: est.created_at,
      atualizadaEm: est.updated_at,
      agendadoPara: est.agendado_para ?? null,
      bio: dados.bio ?? "",
      resumo: resumoDosAlvos(resultados),
      alvos: (dados.alvos ?? []).map((a, i) => ({ ...a, ...(resultados.find((r) => r.n === i + 1) ?? { resultado: "pendente", mensagem: null }) })),
    };
  }
  return NextResponse.json({
    estruturacao,
    nome: input.conta.nome,
    usuario: input.conta.usuario,
    nascimento: input.conta.nascimento,
    senha: input.conta.senha,
    senhaMascarada: mascararSenha(input.conta.senha),
  });
}
