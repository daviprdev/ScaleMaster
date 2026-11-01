import type { SupabaseClient } from "@supabase/supabase-js";
import { isMissingSchemaError } from "@/lib/queue-insights/load";
import { parseJobPrompt, parseJobSteps, type EmulatorJob, type JobStatus } from "./jobs";
import { isOnline, parseInstances, parseTasks } from "./payload";
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
  const [agentsRes, commandsRes, jobsRes] = await Promise.all([
    admin
      .from("emulator_agents")
      .select("id, hostname, agent_version, mumu_version, mumu_error, instances, tasks, last_seen_at, created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: true }),
    admin
      .from("emulator_commands")
      .select("id, agent_id, instance_index, action, task, status, error, result, created_at, finished_at")
      .eq("user_id", userId)
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(200),
    admin
      .from("emulator_jobs")
      .select("id, agent_id, label, template_index, instance_index, steps, status, error, prompt, created_at, updated_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(100),
  ]);

  if (isMissingSchemaError(agentsRes.error) || isMissingSchemaError(commandsRes.error)) {
    return { available: false, agents: [], commands: [], jobsAvailable: false, jobs: [] };
  }
  if (agentsRes.error) throw new EmuladorLoadError(agentsRes.error.message);
  if (commandsRes.error) throw new EmuladorLoadError(commandsRes.error.message);
  const jobsAvailable = !isMissingSchemaError(jobsRes.error);
  if (jobsAvailable && jobsRes.error) throw new EmuladorLoadError(jobsRes.error.message);

  const now = Date.now();
  return {
    available: true,
    agents: ((agentsRes.data ?? []) as AgentRow[]).map((row) => toAgent(row, now)),
    commands: ((commandsRes.data ?? []) as CommandRow[]).map(toCommand),
    jobsAvailable,
    jobs: jobsAvailable ? ((jobsRes.data ?? []) as JobRow[]).map(toJob) : [],
  };
}
