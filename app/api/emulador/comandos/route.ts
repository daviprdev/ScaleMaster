import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { isMissingSchemaError } from "@/lib/queue-insights/load";
import { PC_INDEX, instanceName, isOnline, parseInstances, parseTasks } from "@/lib/emulador/payload";
import type { CommandAction } from "@/lib/emulador/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const ACTIONS: ReadonlySet<string> = new Set<CommandAction>(["launch", "shutdown", "task", "rename"]);
const MAX_PARAMS_JSON = 10_000;

function plainParams(value: unknown): Record<string, unknown> | null {
  if (value === undefined || value === null) return {};
  if (typeof value !== "object" || Array.isArray(value)) return null;
  const text = JSON.stringify(value);
  return text.length <= MAX_PARAMS_JSON ? (JSON.parse(text) as Record<string, unknown>) : null;
}

// POST — põe um comando na fila do agente: abrir o MuMu (instância PC_INDEX),
// abrir/fechar/renomear uma instância ou rodar uma automação nela. O agente pega no
// próximo sync (~3 s). Uma coisa por instância de cada vez.
export async function POST(req: NextRequest) {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
    return NextResponse.json({ error: "Supabase não configurado" }, { status: 503 });
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  let body: { agentId?: unknown; instanceIndex?: unknown; action?: unknown; task?: unknown; params?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Corpo da requisição inválido." }, { status: 400 });
  }

  const { agentId, instanceIndex, action, task } = body;
  if (typeof agentId !== "string" || !agentId) {
    return NextResponse.json({ error: "PC não informado." }, { status: 400 });
  }
  if (typeof instanceIndex !== "number" || !Number.isInteger(instanceIndex)) {
    return NextResponse.json({ error: "Instância não informada." }, { status: 400 });
  }
  if (typeof action !== "string" || !ACTIONS.has(action)) {
    return NextResponse.json({ error: "Ação inválida." }, { status: 400 });
  }
  const params = plainParams(body.params);
  if (!params) return NextResponse.json({ error: "Parâmetros inválidos." }, { status: 400 });
  if (action === "rename") {
    const nome = instanceName(params.nome);
    if (!nome) return NextResponse.json({ error: "Nome inválido: use letras, números, espaço, ponto, _ ou -." }, { status: 400 });
    params.nome = nome;
  }

  const admin = getSupabaseAdmin();
  const { data: agent, error: agentErr } = await admin
    .from("emulator_agents")
    .select("id, instances, tasks, last_seen_at")
    .eq("id", agentId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (isMissingSchemaError(agentErr)) {
    return NextResponse.json({ error: "Falta aplicar o SQL supabase/emulador_agente.sql no Supabase." }, { status: 503 });
  }
  if (agentErr) return NextResponse.json({ error: agentErr.message }, { status: 500 });
  if (!agent) return NextResponse.json({ error: "PC não encontrado." }, { status: 404 });
  if (!isOnline(agent.last_seen_at as string | null)) {
    return NextResponse.json({ error: "O PC está offline. Abra o agente no PC e tente de novo." }, { status: 409 });
  }

  if (instanceIndex === PC_INDEX) {
    if (action !== "launch") return NextResponse.json({ error: "No MuMu em si só dá para abrir." }, { status: 400 });
  } else if (!parseInstances(agent.instances).some((i) => i.index === instanceIndex)) {
    return NextResponse.json({ error: "Essa instância não existe mais no MuMu." }, { status: 404 });
  }
  if (action === "task" && !parseTasks(agent.tasks).some((t) => t.name === task)) {
    return NextResponse.json({ error: "O agente desse PC não conhece essa automação." }, { status: 400 });
  }

  const { data: busy, error: busyErr } = await admin
    .from("emulator_commands")
    .select("id")
    .eq("agent_id", agent.id)
    .eq("instance_index", instanceIndex)
    .in("status", ["queued", "running"])
    .limit(1);

  if (busyErr) return NextResponse.json({ error: busyErr.message }, { status: 500 });
  if (busy?.length) {
    return NextResponse.json({ error: "Essa instância já tem um comando em andamento." }, { status: 409 });
  }

  const { data: command, error } = await admin
    .from("emulator_commands")
    .insert({
      user_id: user.id,
      agent_id: agent.id,
      instance_index: instanceIndex,
      action,
      task: action === "task" ? task : null,
      params,
    })
    .select("id")
    .single();

  // 23514 = check da ação: 'rename' chegou com supabase/emulador_contas.sql.
  if (error?.code === "23514") {
    return NextResponse.json({ error: "Para renomear falta aplicar o SQL supabase/emulador_contas.sql no Supabase." }, { status: 503 });
  }
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ id: command.id });
}
