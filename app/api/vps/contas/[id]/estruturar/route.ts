import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { decrypt, encrypt } from "@/lib/encrypt";
import { isMissingSchemaError } from "@/lib/queue-insights/load";
import { agendadoPara, expandirEtapas, parseEstrutura, type EstruturaInput } from "@/lib/vps/estruturacao";
import { listarMidias, pastaMidias } from "@/lib/vps/midias";
import type { VpsContaInput } from "@/lib/vps/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const FALTA_SQL = "Falta aplicar o SQL supabase/vps_estruturacao.sql no Supabase.";

// POST — "Estruturar" numa conta já criada: põe na fila da VPS um job
// kind = 'estruturacao' no container da conta, com as etapas expandidas por
// alvo (acoes) e o resto criptografado (input_enc). Falha dele nunca mexe no
// status da conta: é outra linha da fila.
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
  const dados = parsed.value;

  const admin = getSupabaseAdmin();
  const { data: conta, error: contaErr } = await admin
    .from("emulator_jobs")
    .select("id, kind, status, label, agent_id, instance_index, input_enc")
    .eq("id", id)
    .eq("user_id", user.id)
    .maybeSingle();
  if (contaErr) return NextResponse.json({ error: contaErr.message }, { status: 500 });
  if (!conta || conta.kind !== "nova-conta") return NextResponse.json({ error: "Conta não encontrada." }, { status: 404 });
  if (conta.status !== "done") return NextResponse.json({ error: "Só dá para estruturar uma conta já criada." }, { status: 409 });

  let input: VpsContaInput;
  try {
    input = JSON.parse(decrypt(conta.input_enc as string)) as VpsContaInput;
  } catch {
    return NextResponse.json({ error: "Não deu para abrir os dados dessa conta." }, { status: 500 });
  }
  const index = typeof conta.instance_index === "number" ? conta.instance_index : input.device?.index;
  if (typeof index !== "number" || !Number.isInteger(index) || index < 0) {
    return NextResponse.json({ error: "Essa conta não tem container." }, { status: 409 });
  }

  // Sem job ativo no container: nem a própria conta rodando, nem outra estruturação na fila.
  const { data: ativa, error: ativaErr } = await admin
    .from("emulator_jobs")
    .select("id")
    .eq("agent_id", conta.agent_id)
    .eq("instance_index", index)
    .in("status", ["queued", "running"])
    .limit(1);
  if (ativaErr) return NextResponse.json({ error: ativaErr.message }, { status: 500 });
  if (ativa?.length) return NextResponse.json({ error: "Esse container já tem algo na fila ou rodando." }, { status: 409 });

  const plano = expandirEtapas(dados);
  const entrada: EstruturaInput = {
    ...dados,
    plano,
    conta: { usuario: input.conta.usuario, senha: input.conta.senha },
    pais: input.pais,
  };
  const { data: job, error } = await admin
    .from("emulator_jobs")
    .insert({
      user_id: user.id,
      agent_id: conta.agent_id,
      kind: "estruturacao",
      label: conta.label ?? input.conta.usuario,
      template_index: index,
      instance_index: index,
      acoes: plano,
      conta_id: conta.id,
      agendado_para: agendadoPara(dados.agendarHoras),
      input_enc: encrypt(JSON.stringify(entrada)),
    })
    .select("id")
    .single();
  // 23514 = o check de kind ainda não conhece 'estruturacao'.
  if (isMissingSchemaError(error) || error?.code === "23514") return NextResponse.json({ error: FALTA_SQL }, { status: 503 });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ id: job.id, etapas: plano.length });
}
