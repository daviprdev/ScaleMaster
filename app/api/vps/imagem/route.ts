import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { isMissingSchemaError } from "@/lib/queue-insights/load";
import { PC_INDEX } from "@/lib/emulador/payload";
import { TAREFA_GOLDEN } from "@/lib/vps/jobs";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// POST — "Rebuild imagem": manda o agente da VPS recriar o container base
// (scripts/vps/golden.sh). O SaaS roda em outra máquina, então o pedido vai
// pela fila de comandos do sync, como uma automação na "instância" -1 (a VPS em si).
export async function POST(req: NextRequest) {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
    return NextResponse.json({ error: "Supabase não configurado" }, { status: 503 });
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  let agentId = "";
  try {
    const body = (await req.json()) as { agentId?: unknown };
    agentId = typeof body.agentId === "string" ? body.agentId : "";
  } catch {
    return NextResponse.json({ error: "Corpo da requisição inválido." }, { status: 400 });
  }
  if (!agentId) return NextResponse.json({ error: "VPS não informada." }, { status: 400 });

  const admin = getSupabaseAdmin();
  const { data: agent, error: agentErr } = await admin
    .from("emulator_agents")
    .select("id, kind")
    .eq("id", agentId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (isMissingSchemaError(agentErr)) {
    return NextResponse.json({ error: "Falta aplicar o SQL supabase/vps_contas.sql no Supabase." }, { status: 503 });
  }
  if (agentErr) return NextResponse.json({ error: agentErr.message }, { status: 500 });
  if (!agent || agent.kind !== "vps") return NextResponse.json({ error: "VPS não encontrada." }, { status: 404 });

  const { data: ativo, error: ativoErr } = await admin
    .from("emulator_commands")
    .select("id")
    .eq("agent_id", agent.id)
    .eq("task", TAREFA_GOLDEN)
    .in("status", ["queued", "running"])
    .limit(1);
  if (ativoErr) return NextResponse.json({ error: ativoErr.message }, { status: 500 });
  if (ativo?.length) return NextResponse.json({ error: "A imagem já está sendo refeita." }, { status: 409 });

  const { data, error } = await admin
    .from("emulator_commands")
    .insert({ user_id: user.id, agent_id: agent.id, instance_index: PC_INDEX, action: "task", task: TAREFA_GOLDEN, params: {} })
    .select("id")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ id: data.id });
}
