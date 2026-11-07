import type { SupabaseClient } from "@supabase/supabase-js";
import { isMissingSchemaError } from "@/lib/queue-insights/load";
import { parseAcoes } from "./atividade";
import { parseJobPrompt, parseJobSteps, type EmulatorJob, type JobStatus } from "./jobs";
import { isOnline, parseInstances, parseMedia, parseTasks } from "./payload";
import type { CommandAction, CommandStatus, EmuladorResponse, EmulatorAgent, EmulatorCommand } from "./types";

const DAY_MS = 24 * 60 * 60_000;

export class EmuladorLoadError extends Error {}

interface AgentRow {
  id: string;
  hostname: string | null;
  agent_version: string | null;
  mumu_version: string | null;
  mumu_error: string | null;
  instances: unknown;
  tasks: unknown;
  /** Só existe depois de supabase/emulador_atividade.sql (versão com a coluna media). */
  media?: unknown;
  /** Só existe depois de supabase/vps_contas.sql: 'mumu' ou 'vps' (a aba Emulador mostra só os 'mumu'). */
  kind?: string;
  last_seen_at: string | null;
  created_at: string;
}

interface CommandRow {
  id: string;
  agent_id: string;
  instance_index: number;
  action: CommandAction;
  task: string | null;
  status: CommandStatus;
  error: string | null;
  result: unknown;
  created_at: string;
  finished_at: string | null;
}

export function toAgent(row: AgentRow, now = Date.now()): EmulatorAgent {
  return {
    id: row.id,
    hostname: row.hostname,
    online: isOnline(row.last_seen_at, now),
    lastSeenAt: row.last_seen_at,
    agentVersion: row.agent_version,
    mumuVersion: row.mumu_version,
    mumuError: row.mumu_error,
    instances: parseInstances(row.instances),
    tasks: parseTasks(row.tasks),
    media: parseMedia(row.media),
    createdAt: row.created_at,
  };
}

function toCommand(row: CommandRow): EmulatorCommand {
  return {
    id: row.id,
    agentId: row.agent_id,
    instanceIndex: row.instance_index,
    action: row.action,
    task: row.task,
    status: row.status,
    error: row.error,
    result: row.result,
    createdAt: row.created_at,
    finishedAt: row.finished_at,
  };
}

interface JobRow {
  id: string;
  agent_id: string;
  kind: string;
  /** Só existe depois de supabase/emulador_atividade.sql. */
  acoes?: unknown;
  label: string | null;
  template_index: number;
  instance_index: number | null;
  steps: unknown;
  status: JobStatus;
  error: string | null;
  prompt: string | null;
  created_at: string;
  updated_at: string;
}

function readPrompt(text: string | null): EmulatorJob["prompt"] {
  if (!text) return null;
  try {
    return parseJobPrompt(JSON.parse(text));
  } catch {
    return null;
  }
}

function toJob(row: JobRow): EmulatorJob {
  return {
    id: row.id,
    agentId: row.agent_id,
    kind: row.kind === "atividade" ? "atividade" : "nova-conta",
    acoes: parseAcoes(row.acoes),
    label: row.label,
    templateIndex: row.template_index,
    instanceIndex: row.instance_index,
    steps: parseJobSteps(row.steps),
    status: row.status,
    error: row.error,
    prompt: readPrompt(row.prompt),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** PCs conectados do usuário + comandos do último dia + fila Nova conta. Lê com service role, sempre filtrando por user_id. */
export async function loadEmulador(admin: SupabaseClient, userId: string): Promise<EmuladorResponse> {
  const since = new Date(Date.now() - DAY_MS).toISOString();
  const jobColumns = "id, agent_id, kind, label, template_index, instance_index, steps, status, error, prompt, created_at, updated_at";
  const agentColumns = "id, hostname, agent_version, mumu_version, mumu_error, instances, tasks, last_seen_at, created_at";
  const agentsQuery = (columns: string) =>
    admin.from("emulator_agents").select(columns).eq("user_id", userId).order("created_at", { ascending: true });
  const [agentsResKind, commandsRes] = await Promise.all([
    agentsQuery(`${agentColumns}, media, kind`),
    admin
      .from("emulator_commands")
      .select("id, agent_id, instance_index, action, task, status, error, result, created_at, finished_at")
      .eq("user_id", userId)
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(200),
  ]);
  // Sem a coluna kind (vps_contas.sql ainda não aplicado): lê sem ela; sem a
  // coluna media (versão nova de emulador_atividade.sql ainda não aplicada): lê sem as duas.
  // decisão: sem a coluna kind todos os agentes continuam nesta aba (nada some) e vpsAvailable=false avisa que o SQL da VPS falta.
  const vpsAvailable = !isMissingSchemaError(agentsResKind.error);
  const agentsResFull = vpsAvailable ? agentsResKind : await agentsQuery(`${agentColumns}, media`);
  const mediaAvailable = !isMissingSchemaError(agentsResFull.error);
  const agentsRes = mediaAvailable ? agentsResFull : await agentsQuery(agentColumns);

  if (isMissingSchemaError(agentsRes.error) || isMissingSchemaError(commandsRes.error)) {
    return { available: false, agents: [], commands: [], jobsAvailable: false, atividadeAvailable: false, jobs: [] };
  }
  if (agentsRes.error) throw new EmuladorLoadError(agentsRes.error.message);
  if (commandsRes.error) throw new EmuladorLoadError(commandsRes.error.message);

  // Agentes da VPS (aba Contas VPS) ficam fora desta aba, e as contas deles também: a fila é a mesma
  // tabela, e os lotes da VPS empurrariam as contas do MuMu para fora do limite.
  const agentRows = ((agentsRes.data ?? []) as unknown as AgentRow[]).filter((row) => !vpsAvailable || row.kind !== "vps");
  const mumuIds = agentRows.map((row) => row.id);
  const jobsQuery = (columns: string) =>
    admin.from("emulator_jobs").select(columns).eq("user_id", userId).in("agent_id", mumuIds).order("created_at", { ascending: false }).limit(100);
  const jobsResFull = mumuIds.length > 0 ? await jobsQuery(`${jobColumns}, acoes`) : { data: [], error: null };
  // Sem a coluna acoes (emulador_atividade.sql ainda não aplicado): lê sem ela e o Estruturar fica escondido.
  const atividadeAvailable = !isMissingSchemaError(jobsResFull.error) && mediaAvailable;
  const jobsRes = atividadeAvailable || mumuIds.length === 0 ? jobsResFull : await jobsQuery(jobColumns);
  const jobsAvailable = !isMissingSchemaError(jobsRes.error);
  if (jobsAvailable && jobsRes.error) throw new EmuladorLoadError(jobsRes.error.message);

  const now = Date.now();
  return {
    available: true,
    agents: agentRows.map((row) => toAgent(row, now)),
    commands: ((commandsRes.data ?? []) as CommandRow[]).map(toCommand),
    jobsAvailable,
    atividadeAvailable: jobsAvailable && atividadeAvailable,
    jobs: jobsAvailable ? ((jobsRes.data ?? []) as unknown as JobRow[]).map(toJob) : [],
    vpsAvailable,
  };
}
