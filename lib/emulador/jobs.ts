import { shortText } from "./payload";

/**
 * "Criar instância" na aba Emulador: o agente cria uma conta numa cópia da
 * instância padrão, etapa por etapa. SQL em supabase/emulador_contas.sql; o
 * fluxo do lado do PC fica em agente-mumu/fluxos/nova-conta.mjs (mesmas chaves).
 */

export type JobStatus = "queued" | "running" | "done" | "error";
export type StepStatus = "running" | "done" | "error";

export interface JobStep {
  key: string;
  status: StepStatus;
  message: string | null;
}

/**
 * O agente parou e precisa do dono: "codigo" = o código que chegou no Gmail;
 * "manual" = uma tela que ele não conhece (o dono resolve na instância e manda
 * continuar).
 */
export interface JobPrompt {
  tipo: "codigo" | "manual";
  texto: string;
}

export interface EmulatorJob {
  id: string;
  agentId: string;
  label: string | null;
  templateIndex: number;
  instanceIndex: number | null;
  steps: JobStep[];
  status: JobStatus;
  error: string | null;
  prompt: JobPrompt | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * Fim da conta quando o Instagram trava pedindo telefone: o agente desliga a
 * instância e a conta termina com este erro exato (igual a ALERTA_TELEFONE em
 * agente-mumu/fluxos/nova-conta.mjs). A aba mostra em vermelho na linha da instância.
 */
export const ALERTA_TELEFONE = "Conta ERRO CRIAÇÃO, verificar com numero telefone";

/**
 * Avisos por índice de instância de um PC. O MuMu reaproveita índices de
 * instância apagada, então o aviso só vale se a instância ainda tem o nome que
 * a conta deu a ela (mensagem da etapa "nome").
 */
export function instanceAlerts(
  jobs: readonly EmulatorJob[],
  agentId: string,
  instances: ReadonlyArray<{ index: number; name: string }>
): Map<number, string> {
  const out = new Map<number, string>();
  for (const job of jobs) {
    if (job.agentId !== agentId || job.error !== ALERTA_TELEFONE || job.instanceIndex === null) continue;
    const nome = job.steps.find((s) => s.key === "nome")?.message;
    const inst = instances.find((i) => i.index === job.instanceIndex);
    if (inst && nome && inst.name === nome && !out.has(inst.index)) out.set(inst.index, ALERTA_TELEFONE);
  }
  return out;
}

/** Etapas na ordem. O Instagram baixa antes da proxy para os 275 MB não passarem por ela. */
export const NOVA_CONTA_FLUXO: ReadonlyArray<{ key: string; label: string }> = [
  { key: "copiar", label: "Copiar a instância padrão" },
  { key: "ids", label: "Trocar IMEI, Android ID e MAC" },
  { key: "nome", label: "Dar o nome da conta à instância" },
  { key: "abrir", label: "Ligar a instância" },
  { key: "instagram", label: "Instalar o Instagram pelo Aurora" },
  { key: "proxy", label: "Proxy no NekoBox" },
  { key: "cadastro", label: "Criar a conta no Instagram" },
];

export interface NovaContaInput {
  /** URL normalizada, ex.: http://usuario:senha@host:porta */
  proxy: string;
  conta: {
    email: string;
    senha: string;
    nome: string;
    usuario: string;
    nascimento: string;
  };
}

const STEP_KEY_RE = /^[a-z0-9-]{1,30}$/;
const STEP_STATUSES: ReadonlySet<string> = new Set<StepStatus>(["running", "done", "error"]);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function parseJobSteps(raw: unknown): JobStep[] {
  if (!Array.isArray(raw)) return [];
  const out: JobStep[] = [];
  const seen = new Set<string>();
  for (const item of raw.slice(0, 30)) {
    if (!item || typeof item !== "object") continue;
    const r = item as Record<string, unknown>;
    if (typeof r.key !== "string" || !STEP_KEY_RE.test(r.key) || seen.has(r.key)) continue;
    if (typeof r.status !== "string" || !STEP_STATUSES.has(r.status)) continue;
    seen.add(r.key);
    out.push({ key: r.key, status: r.status as StepStatus, message: shortText(r.message, 300) });
  }
  return out;
}

export function parseJobPrompt(raw: unknown): JobPrompt | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (r.tipo !== "codigo" && r.tipo !== "manual") return null;
  return { tipo: r.tipo, texto: shortText(r.texto, 500) ?? "" };
}

export interface JobUpdate {
  id: string;
  /** undefined = o agente não mexeu; número = a cópia criada. */
  instanceIndex: number | undefined;
  steps: JobStep[];
  status: "running" | "done" | "error";
  error: string | null;
  /** undefined = não mexe; null = o agente não está esperando nada. */
  prompt: JobPrompt | null | undefined;
}

/** Andamento que o agente manda no sync, uma entrada por conta que mudou. */
export function parseJobUpdates(raw: unknown): JobUpdate[] {
  if (!Array.isArray(raw)) return [];
  const out: JobUpdate[] = [];
  for (const item of raw.slice(0, 10)) {
    if (!item || typeof item !== "object") continue;
    const r = item as Record<string, unknown>;
    if (typeof r.id !== "string" || !UUID_RE.test(r.id)) continue;
    if (r.status !== "running" && r.status !== "done" && r.status !== "error") continue;
    const idx = r.instanceIndex;
    out.push({
      id: r.id,
      instanceIndex: typeof idx === "number" && Number.isInteger(idx) && idx >= 0 && idx < 10_000 ? idx : undefined,
      steps: parseJobSteps(r.steps),
      status: r.status,
      error: r.status === "error" ? (shortText(r.error, 500) ?? "Erro sem mensagem.") : null,
      prompt: r.prompt === undefined ? undefined : r.status === "running" ? parseJobPrompt(r.prompt) : null,
    });
  }
  return out;
}
