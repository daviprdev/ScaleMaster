import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { isMissingSchemaError } from "@/lib/queue-insights/load";
import { agentTokenFromRequest, hashAgentToken } from "@/lib/emulador/token";
import { parseJobUpdates } from "@/lib/emulador/jobs";
import { syncJobs, type ClaimedJob } from "@/lib/emulador/sync-jobs";
import {
  QUEUED_COMMAND_TTL_MS,
  parseInstances,
  parseResults,
  parseRunning,
  parseTasks,
  shortText,
} from "@/lib/emulador/payload";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_CLAIM = 10;

interface ActiveRow {
  id: string;
  status: "queued" | "running";
  created_at: string;
  instance_index: number;
  action: string;
  task: string | null;
  params: unknown;
}

/**
 * POST — o agente do PC (agente-mumu/) chama a cada ~3 s com
 * `Authorization: Bearer smag_…`. Num só pedido ele:
 *   1. manda o retrato do PC (instâncias do MuMu, automações que conhece);
 *   2. entrega o resultado dos comandos que terminou e a lista dos que ainda
 *      estão rodando;
 *   3. recebe os comandos novos, já marcados como running.
 * Comando em running que o agente não cita mais (fechou ou reiniciou no meio)
 * vira erro; comando que ficou na fila com o PC fora expira. A fila Nova
 * conta (jobUpdates/runningJobs → jobs) segue a mesma ideia em syncJobs.
 */
export async function POST(req: NextRequest) {
  const token = agentTokenFromRequest(req);
  if (!token) return NextResponse.json({ error: "Código do agente ausente ou inválido." }, { status: 401 });

  const admin = getSupabaseAdmin();
  const { data: agent, error: agentErr } = await admin
    .from("emulator_agents")
    .select("id")
    .eq("token_hash", hashAgentToken(token))
    .maybeSingle();

  if (isMissingSchemaError(agentErr)) {
    return NextResponse.json({ error: "Falta aplicar o SQL supabase/emulador_agente.sql no Supabase." }, { status: 503 });
  }
  if (agentErr) return NextResponse.json({ error: agentErr.message }, { status: 500 });
  if (!agent) {
    return NextResponse.json({ error: "Código não reconhecido. Gere outro na aba Emulador do Scale Master." }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    const parsed: unknown = await req.json();
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error();
    body = parsed as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Corpo da requisição inválido." }, { status: 400 });
  }

  const nowMs = Date.now();
  const now = new Date(nowMs).toISOString();

  const { error: updateErr } = await admin
    .from("emulator_agents")
    .update({
      hostname: shortText(body.hostname, 100),
      agent_version: shortText(body.agentVersion, 20),
      mumu_version: shortText(body.mumuVersion, 40),
      mumu_error: shortText(body.mumuError, 300),
      instances: parseInstances(body.instances),
      tasks: parseTasks(body.tasks),
      last_seen_at: now,
    })
    .eq("id", agent.id);
  if (updateErr) return NextResponse.json({ error: updateErr.message }, { status: 500 });

  const results = parseResults(body.results);
  const stillRunning = new Set(parseRunning(body.running));

  const resultUpdates = await Promise.all(
    results.map((r) =>
      admin
        .from("emulator_commands")
        .update({ status: r.status, error: r.error, result: r.result, finished_at: now })
        .eq("id", r.id)
        .eq("agent_id", agent.id)
        .in("status", ["queued", "running"])
    )
  );
  const resultErr = resultUpdates.find((r) => r.error)?.error;
  if (resultErr) return NextResponse.json({ error: resultErr.message }, { status: 500 });

  const { data: activeData, error: activeErr } = await admin
    .from("emulator_commands")
    .select("id, status, created_at, instance_index, action, task, params")
    .eq("agent_id", agent.id)
    .in("status", ["queued", "running"])
    .order("created_at", { ascending: true });
  if (activeErr) return NextResponse.json({ error: activeErr.message }, { status: 500 });

  const reported = new Set(results.map((r) => r.id));
  const active = (activeData ?? []) as ActiveRow[];
  const orphans = active
    .filter((c) => c.status === "running" && !stillRunning.has(c.id) && !reported.has(c.id))
    .map((c) => c.id);
  const queued = active.filter((c) => c.status === "queued");
  const expired = queued.filter((c) => nowMs - Date.parse(c.created_at) > QUEUED_COMMAND_TTL_MS).map((c) => c.id);
  const toClaim = queued.filter((c) => !expired.includes(c.id)).slice(0, MAX_CLAIM).map((c) => c.id);

  const failures = [
    { ids: orphans, error: "O agente parou antes de terminar (fechou, reiniciou ou perdeu a conexão)." },
    { ids: expired, error: "O PC ficou offline e o comando expirou." },
  ].filter((f) => f.ids.length > 0);
  for (const f of failures) {
    const { error } = await admin
      .from("emulator_commands")
      .update({ status: "error", error: f.error, finished_at: now })
      .in("id", f.ids)
      .in("status", ["queued", "running"]);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }

  let claimed: ActiveRow[] = [];
  if (toClaim.length > 0) {
    const { data, error: claimErr } = await admin
      .from("emulator_commands")
      .update({ status: "running", started_at: now })
      .in("id", toClaim)
      .eq("status", "queued")
      .select("id, created_at, instance_index, action, task, params");
    if (claimErr) return NextResponse.json({ error: claimErr.message }, { status: 500 });
    claimed = (data ?? []) as ActiveRow[];
  }

  const commands = claimed
    .sort((a, b) => a.created_at.localeCompare(b.created_at))
    .map((c) => ({
      id: c.id,
      instanceIndex: c.instance_index,
      action: c.action,
      task: c.task,
      params: c.params ?? {},
    }));

  let jobs: ClaimedJob[];
  try {
    // runningJobs ausente = agente anterior à fila Nova conta: não recebe conta.
    const runningJobs = Array.isArray(body.runningJobs) ? new Set(parseRunning(body.runningJobs)) : null;
    jobs = await syncJobs(admin, agent.id, parseJobUpdates(body.jobUpdates), runningJobs, now);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }

  return NextResponse.json({ commands, jobs });
}
