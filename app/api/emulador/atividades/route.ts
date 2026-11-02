import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { encrypt } from "@/lib/encrypt";
import { isMissingSchemaError } from "@/lib/queue-insights/load";
import { parseInstances } from "@/lib/emulador/payload";
import { parseAtividadeInput } from "@/lib/emulador/atividade";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// POST — põe na fila do PC uma Atividade numa instância que já tem conta:
// aquecer, trocar a foto de perfil e/ou postar story com link e destacar. As
// mídias já subiram por /api/emulador/atividades/midia; link, textos e os
// caminhos delas vão criptografados, e a tela só vê o que foi marcado (acoes).
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

  const { agentId, instanceIndex } = body;
  if (typeof agentId !== "string" || !agentId) {
    return NextResponse.json({ error: "PC não informado." }, { status: 400 });
  }
  if (typeof instanceIndex !== "number" || !Number.isInteger(instanceIndex) || instanceIndex < 0) {
    return NextResponse.json({ error: "Instância inválida." }, { status: 400 });
  }
  const parsed = parseAtividadeInput(body, user.id);
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
  const instance = parseInstances(agent.instances).find((i) => i.index === instanceIndex);
  if (!instance) return NextResponse.json({ error: "Essa instância não existe mais no MuMu." }, { status: 404 });

  const { data: ativa, error: ativaErr } = await admin
    .from("emulator_jobs")
    .select("id")
    .eq("agent_id", agent.id)
    .eq("instance_index", instanceIndex)
    .in("status", ["queued", "running"])
    .limit(1);
  if (ativaErr) return NextResponse.json({ error: ativaErr.message }, { status: 500 });
  if (ativa?.length) return NextResponse.json({ error: "Essa instância já tem algo na fila." }, { status: 409 });

  const { data: job, error } = await admin
    .from("emulator_jobs")
    .insert({
      user_id: user.id,
      agent_id: agent.id,
      kind: "atividade",
      label: instance.name,
      template_index: instanceIndex,
      instance_index: instanceIndex,
      acoes: parsed.value.acoes,
      input_enc: encrypt(JSON.stringify(parsed.value)),
    })
    .select("id")
    .single();

  if (isMissingSchemaError(error) || error?.code === "23514") {
    return NextResponse.json({ error: "Falta aplicar o SQL supabase/emulador_atividade.sql no Supabase." }, { status: 503 });
  }
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ id: job.id });
}
