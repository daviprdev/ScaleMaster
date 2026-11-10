import type { SupabaseClient } from "@supabase/supabase-js";
import { decrypt } from "@/lib/encrypt";
import { isMissingSchemaError } from "@/lib/queue-insights/load";
import { parseJobPrompt, parseJobSteps, type JobStatus } from "@/lib/emulador/jobs";
import { isOnline, parseInstances } from "@/lib/emulador/payload";
import { parsePlano } from "./estruturacao";
import { parseCapacidade } from "./jobs";
import { ipDoDevice } from "./device";
import type { VpsAgent, VpsDevice, VpsDeviceSpec, VpsDeviceStatus, VpsJob, VpsResponse } from "./types";

/** Leitura da aba Contas VPS: só agentes kind='vps' do usuário, as contas deles e os devices. */

export class VpsLoadError extends Error {}

interface AgentRow {
  id: string;
  hostname: string | null;
  agent_version: string | null;
  mumu_version: string | null;
  mumu_error: string | null;
  instances: unknown;
  capacidade: unknown;
  last_seen_at: string | null;
  created_at: string;
}

interface JobRow {
  id: string;
  agent_id: string;
  kind: string;
  label: string | null;
  template_index: number;
  instance_index: number | null;
  steps: unknown;
  status: JobStatus;
  error: string | null;
  prompt: string | null;
  lote_id: string | null;
  pausa: string | null;
  versao_ig: string | null;
  created_at: string;
  updated_at: string;
  /** Só na leitura da aba: para mostrar host:porta da proxy no painel (nunca a credencial). */
  input_enc?: string | null;
  /** Só com supabase/vps_estruturacao.sql aplicado. */
  acoes?: unknown;
  conta_id?: string | null;
  agendado_para?: string | null;
}

interface DeviceRow {
  id: string;
  job_id: string;
  android_id: string;
  serial: string;
  mac: string;
  model: string;
  manufacturer: string;
  fingerprint: string;
  resolucao: string;
  timezone: string;
  locale: string;
  container: string;
  volume: string;
  status: VpsDeviceStatus;
  created_at: string;
}

export function toVpsAgent(row: AgentRow, now = Date.now()): VpsAgent {
  return {
    id: row.id,
    hostname: row.hostname,
    online: isOnline(row.last_seen_at, now),
    lastSeenAt: row.last_seen_at,
    agentVersion: row.agent_version,
    // O agente da VPS manda a versão do Docker/redroid no mesmo campo do MuMu.
    engineVersion: row.mumu_version,
    engineError: row.mumu_error,
    instances: parseInstances(row.instances),
    capacidade: parseCapacidade(row.capacidade),
    createdAt: row.created_at,
  };
}

function readPrompt(text: string | null): VpsJob["prompt"] {
  if (!text) return null;
  try {
    return parseJobPrompt(JSON.parse(text));
  } catch {
    return null;
  }
}

/** host:porta da proxy guardada no input criptografado da conta; null se não der para ler. */
export function proxyHostDe(inputEnc: string | null | undefined): string | null {
  if (!inputEnc) return null;
  try {
    const input = JSON.parse(decrypt(inputEnc)) as { proxy?: unknown };
    const u = new URL(String(input.proxy ?? ""));
    return u.hostname ? `${u.hostname}${u.port ? `:${u.port}` : ""}` : null;
  } catch {
    return null;
  }
}

/** IP e rede do container guardados na identidade da conta (input criptografado); null se não der para ler. */
export function redeDe(inputEnc: string | null | undefined): { ip: string; rede: number; container: string } | null {
  if (!inputEnc) return null;
  try {
    const { device } = JSON.parse(decrypt(inputEnc)) as { device?: VpsDeviceSpec };
    if (!device || !Number.isInteger(device.index)) return null;
    return { ip: ipDoDevice(device), rede: device.rede ?? 0, container: device.container };
  } catch {
    return null;
  }
}

export function toVpsJob(row: JobRow): VpsJob {
  return {
    id: row.id,
    agentId: row.agent_id,
    kind: row.kind === "atividade" ? "atividade" : row.kind === "estruturacao" ? "estruturacao" : "nova-conta",
    acoes: [],
    label: row.label,
    templateIndex: row.template_index,
    instanceIndex: row.instance_index,
    steps: parseJobSteps(row.steps),
    status: row.status,
    error: row.error,
    prompt: readPrompt(row.prompt),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    loteId: row.lote_id,
    pausa: row.pausa === "proxy" ? "proxy" : null,
    versaoIg: row.versao_ig,
    proxyHost: row.kind === "estruturacao" ? null : proxyHostDe(row.input_enc),
    ip: row.kind === "estruturacao" ? null : (redeDe(row.input_enc)?.ip ?? null),
    ...(row.kind === "estruturacao" ? { plano: parsePlano(row.acoes), contaId: row.conta_id ?? null, agendadoPara: row.agendado_para ?? null } : {}),
  };
}

function toDevice(row: DeviceRow): VpsDevice {
  return {
    id: row.id,
    jobId: row.job_id,
    androidId: row.android_id,
    serial: row.serial,
    mac: row.mac,
    model: row.model,
    manufacturer: row.manufacturer,
    fingerprint: row.fingerprint,
    resolucao: row.resolucao,
    timezone: row.timezone,
    locale: row.locale,
    container: row.container,
    volume: row.volume,
    status: row.status,
    createdAt: row.created_at,
  };
}

export const AGENT_COLUMNS = "id, hostname, agent_version, mumu_version, mumu_error, instances, capacidade, last_seen_at, created_at";
export const JOB_COLUMNS =
  "id, agent_id, kind, label, template_index, instance_index, steps, status, error, prompt, lote_id, pausa, versao_ig, created_at, updated_at";
/** Colunas do Estruturar (supabase/vps_estruturacao.sql); sem elas a aba lê só as de sempre. */
const ESTRUTURA_COLUMNS = "acoes, conta_id, agendado_para";
const DEVICE_COLUMNS =
  "id, job_id, android_id, serial, mac, model, manufacturer, fingerprint, resolucao, timezone, locale, container, volume, status, created_at";

export async function loadVps(admin: SupabaseClient, userId: string): Promise<VpsResponse> {
  const agentsRes = await admin
    .from("emulator_agents")
    .select(AGENT_COLUMNS)
    .eq("user_id", userId)
    .eq("kind", "vps")
    .order("created_at", { ascending: true });
  if (isMissingSchemaError(agentsRes.error)) {
    return { available: false, jobsAvailable: false, agents: [], jobs: [], devices: [] };
  }
  if (agentsRes.error) throw new VpsLoadError(agentsRes.error.message);
  const now = Date.now();
  const agents = ((agentsRes.data ?? []) as unknown as AgentRow[]).map((row) => toVpsAgent(row, now));
  if (agents.length === 0) return { available: true, jobsAvailable: true, agents, jobs: [], devices: [] };

  const agentIds = agents.map((a) => a.id);
  const lerJobs = (colunas: string) =>
    admin.from("emulator_jobs").select(colunas).eq("user_id", userId).in("agent_id", agentIds).order("created_at", { ascending: false }).limit(400);
  const [jobsCompletos, devicesRes] = await Promise.all([
    lerJobs(`${JOB_COLUMNS}, input_enc, ${ESTRUTURA_COLUMNS}`),
    admin.from("vps_devices").select(DEVICE_COLUMNS).eq("user_id", userId).order("created_at", { ascending: false }).limit(300),
  ]);
  // Sem o SQL do Estruturar as colunas novas não existem: lê de novo só com as antigas.
  const estruturaAvailable = !isMissingSchemaError(jobsCompletos.error);
  const jobsRes = estruturaAvailable ? jobsCompletos : await lerJobs(`${JOB_COLUMNS}, input_enc`);
  if (isMissingSchemaError(jobsRes.error)) return { available: true, jobsAvailable: false, agents, jobs: [], devices: [] };
  if (jobsRes.error) throw new VpsLoadError(jobsRes.error.message);
  if (devicesRes.error && !isMissingSchemaError(devicesRes.error)) throw new VpsLoadError(devicesRes.error.message);

  return {
    available: true,
    jobsAvailable: true,
    agents,
    jobs: ((jobsRes.data ?? []) as unknown as JobRow[]).map(toVpsJob),
    devices: ((devicesRes.data ?? []) as unknown as DeviceRow[]).map(toDevice),
    estruturaAvailable,
  };
}
