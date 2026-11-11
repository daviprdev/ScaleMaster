import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { isMissingSchemaError } from "@/lib/queue-insights/load";
import { agentTokenFromRequest, hashAgentToken } from "@/lib/emulador/token";
import { parseJobUpdates } from "@/lib/emulador/jobs";
import { parseCapacidade } from "@/lib/vps/jobs";
import { MAX_CONCURRENT_JOBS_PER_AGENT } from "@/lib/emulador/sync-jobs";
import { syncDeletes, syncJobs, syncRenames, type SyncJobsResult } from "@/lib/emulador/sync-jobs";
import {
  QUEUED_COMMAND_TTL_MS,
  parseAgentKind,
  parseInstances,
  parseMedia,
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
 * conta (jobUpdates/runningJobs → jobs, replies) segue a mesma ideia em syncJobs.
 */
export async function POST(req: NextRequest) {
  const token = agentTokenFromRequest(req);
  if (!token) return NextResponse.json({ error: "Código do agente ausente ou inválido." }, { status: 401 });

  const admin = getSupabaseAdmin();
  const { data: agent, error: agentErr } = await admin
    .from("emulator_agents")
    .select("id, user_id")
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

  const retrato = {
    hostname: shortText(body.hostname, 100),
    agent_version: shortText(body.agentVersion, 20),
    mumu_version: shortText(body.mumuVersion, 40),
    mumu_error: shortText(body.mumuError, 300),
    instances: parseInstances(body.instances),
    tasks: parseTasks(body.tasks),
    last_seen_at: now,
  };
  // Colunas que só existem depois de outros SQLs: media (pasta do MuMu, só vem
  // quando mudou), kind e capacidade (agente da VPS). Sem elas (SQL não
  // aplicado), grava o resto.
  const agentKind = parseAgentKind(body.agentKind);
  const extras: Record<string, unknown> = {};
  if (body.media !== undefined) extras.media = parseMedia(body.media);
  // kind só vai quando o agente se declara (agente antigo do MuMu não manda nada e fica como está).
  if (body.agentKind !== undefined) extras.kind = agentKind;
  if (agentKind === "vps" && body.capacity !== undefined) extras.capacidade = parseCapacidade(body.capacity);
  // Falha ao gravar kind/capacidade (ou media) nunca derruba o sync: loga, tenta sem elas e segue.
  let { error: updateErr } = await admin.from("emulator_agents").update({ ...retrato, ...extras }).eq("id", agent.id);
  if (updateErr && body.media !== undefined) {
    if (!isMissingSchemaError(updateErr)) console.warn(`[emulador/sync] kind/capacidade não gravados: ${updateErr.message}`);
    ({ error: updateErr } = await admin.from("emulator_agents").update({ ...retrato, media: extras.media }).eq("id", agent.id));
  }
  if (updateErr) {
    if (!isMissingSchemaError(updateErr)) console.warn(`[emulador/sync] extras não gravados: ${updateErr.message}`);
    ({ error: updateErr } = await admin.from("emulator_agents").update(retrato).eq("id", agent.id));
  }
  if (updateErr) return NextResponse.json({ error: updateErr.message }, { status: 500 });
  // VPS: cadastros simultâneos = o que a máquina aguenta (max(2, vCPU/2)); MuMu: 2.
  const maxConcurrent = agentKind === "vps" ? parseCapacidade(body.capacity).maxCadastro : MAX_CONCURRENT_JOBS_PER_AGENT;

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
  // Só mantém os dados ligados à instância renomeada (ou tira os da excluída): falha aqui não trava o sync do PC.
  const doneIds = results.filter((r) => r.status === "done").map((r) => r.id);
  await syncRenames(admin, agent.id, doneIds).catch((e: Error) => console.error(`[emulador/sync] renomear dados: ${e.message}`));
  await syncDeletes(admin, agent.id, doneIds).catch((e: Error) => console.error(`[emulador/sync] excluir dados: ${e.message}`));

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

  let jobSync: SyncJobsResult;
  try {
    // runningJobs ausente = agente anterior à fila Nova conta: não recebe conta.
    const runningJobs = Array.isArray(body.runningJobs) ? new Set(parseRunning(body.runningJobs)) : null;
    jobSync = await syncJobs(admin, agent.id, parseJobUpdates(body.jobUpdates), runningJobs, now, maxConcurrent);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }

  // Boot do agente da VPS: os containers que o SaaS conhece (linhas de vps_devices e contas da fila), para ele
  // achar os órfãos. Qualquer erro de leitura = campo ausente (o agente não apaga nada sem a lista).
  let conhecidos: string[] | undefined;
  if (agentKind === "vps" && body.querConhecidos === true) {
    const [devs, contas] = await Promise.all([
      admin.from("vps_devices").select("container").eq("user_id", agent.user_id),
      admin.from("emulator_jobs").select("instance_index").eq("agent_id", agent.id).not("instance_index", "is", null),
    ]);
    if (!devs.error && !contas.error) {
      conhecidos = [
        ...new Set([
          ...((devs.data ?? []) as Array<{ container: string | null }>).map((d) => d.container ?? "").filter(Boolean),
          ...((contas.data ?? []) as Array<{ instance_index: number }>).map((j) => `ig-${j.instance_index}`),
        ]),
      ];
    }
  }

  return NextResponse.json({ commands, jobs: jobSync.jobs, replies: jobSync.replies, ...(conhecidos ? { conhecidos } : {}) });
}
