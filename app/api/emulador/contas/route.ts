import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { encrypt } from "@/lib/encrypt";
import { isMissingSchemaError } from "@/lib/queue-insights/load";
import { parseInstances } from "@/lib/emulador/payload";
import { parseNovaContaInput } from "@/lib/emulador/nova-conta-input";
import { STEPS_CONTA_AQUI, registroSteps } from "@/lib/emulador/jobs";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const isIndex = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v >= 0;

// POST — põe na fila do agente do PC uma conta a criar. Dois jeitos:
//   templateIndex → "Criar instância": numa cópia nova da instância padrão;
//   instanceIndex → "Criar conta aqui": na própria instância (pula copiar e
//                   trocar IDs; o resto do fluxo roda, com o Instagram zerado).
// Com registrar: true + instanceIndex é o Editar dados de uma instância sem
// conta do sistema: só guarda os dados da conta que já está nela (nasce
// "done", nada roda no PC).
// Proxy e dados da conta vão criptografados; a tela só volta a ver o rótulo
// (o @ ou, sem ele, o Gmail).
export async function POST(req: NextRequest) {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
    return NextResponse.json({ error: "Supabase não configurado" }, { status: 503 });
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Corpo da requisição inválido." }, { status: 400 });
  }

  const { agentId, templateIndex, instanceIndex } = body;
  if (typeof agentId !== "string" || !agentId) {
    return NextResponse.json({ error: "PC não informado." }, { status: 400 });
  }
  const registrar = body.registrar === true;
  const aqui = registrar || instanceIndex !== undefined;
  const alvo = aqui ? instanceIndex : templateIndex;
  if (!isIndex(alvo)) {
    return NextResponse.json({ error: aqui ? "Instância inválida." : "Escolha a instância padrão." }, { status: 400 });
  }
  const parsed = parseNovaContaInput(body);
  if ("error" in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 });

  const admin = getSupabaseAdmin();
  const { data: agent, error: agentErr } = await admin
    .from("emulator_agents")
    .select("id, instances")
    .eq("id", agentId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (agentErr) return NextResponse.json({ error: agentErr.message }, { status: 500 });
  if (!agent) return NextResponse.json({ error: "PC não encontrado." }, { status: 404 });
  const instancia = parseInstances(agent.instances).find((i) => i.index === alvo);
  if (!instancia) {
    return NextResponse.json({ error: "Essa instância não existe mais no MuMu." }, { status: 404 });
  }

  if (aqui) {
    const { data: ativa, error: ativaErr } = await admin
      .from("emulator_jobs")
      .select("id")
      .eq("agent_id", agent.id)
      .eq("instance_index", alvo)
      .in("status", ["queued", "running"])
      .limit(1);
    if (ativaErr && !isMissingSchemaError(ativaErr)) return NextResponse.json({ error: ativaErr.message }, { status: 500 });
    if (ativa?.length) return NextResponse.json({ error: "Essa instância já tem uma conta na fila." }, { status: 409 });
  }

  const { data: job, error } = await admin
    .from("emulator_jobs")
    .insert({
      user_id: user.id,
      agent_id: agent.id,
      label: parsed.value.conta.usuario || parsed.value.conta.email,
      template_index: alvo,
      ...(registrar
        ? { instance_index: alvo, steps: registroSteps(instancia.name), status: "done", finished_at: new Date().toISOString() }
        : aqui
          ? { instance_index: alvo, steps: STEPS_CONTA_AQUI }
          : {}),
      input_enc: encrypt(JSON.stringify(parsed.value)),
    })
    .select("id")
    .single();

  if (isMissingSchemaError(error)) {
    return NextResponse.json({ error: "Falta aplicar o SQL supabase/emulador_contas.sql no Supabase." }, { status: 503 });
  }
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ id: job.id });
}
