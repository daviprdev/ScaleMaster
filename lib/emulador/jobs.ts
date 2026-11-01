import { shortText } from "./payload";

/**
 * "Nova conta" na aba Emulador: o agente cria uma conta numa cópia da
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

export interface EmulatorJob {
  id: string;
  agentId: string;
  label: string | null;
  templateIndex: number;
  instanceIndex: number | null;
  steps: JobStep[];
  status: JobStatus;
  error: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Etapas na ordem. ready=false: ainda não automatizada (aparece como "em breve"). */
export const NOVA_CONTA_FLUXO: ReadonlyArray<{ key: string; label: string; ready: boolean }> = [
  { key: "copiar", label: "Copiar a instância padrão", ready: true },
  { key: "imei", label: "Trocar o IMEI", ready: true },
  { key: "nome", label: "Dar o nome da conta à instância", ready: true },
  { key: "abrir", label: "Ligar a instância", ready: true },
  { key: "proxy", label: "Proxy no NekoBox", ready: false },
  { key: "instagram", label: "Instalar o Instagram", ready: false },
  { key: "cadastro", label: "Criar a conta no Instagram", ready: false },
];

export interface NovaContaInput {
  proxy: string;
  conta: {
    nome: string;
    usuario: string;
    senha: string;
    contato: string;
    nascimento: string;
  };
}

const USERNAME_RE = /^[A-Za-z0-9._]{1,30}$/;
const BIRTH_RE = /^(\d{2})\/(\d{2})\/(\d{4})$/;

function field(value: unknown, max: number): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

/** Valida o formulário Nova conta. Campos vazios são aceitos (as etapas que usam cada um ainda vão chegar). */
export function parseNovaContaInput(raw: unknown): { value: NovaContaInput } | { error: string } {
  const body = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const conta = body.conta && typeof body.conta === "object" ? (body.conta as Record<string, unknown>) : {};

  const value: NovaContaInput = {
    proxy: field(body.proxy, 300),
    conta: {
      nome: field(conta.nome, 60),
      usuario: field(conta.usuario, 30).replace(/^@/, ""),
      senha: field(conta.senha, 100),
      contato: field(conta.contato, 100),
      nascimento: field(conta.nascimento, 10),
    },
  };

  if (value.conta.usuario && !USERNAME_RE.test(value.conta.usuario)) {
    return { error: "Usuário do Instagram só pode ter letras, números, ponto e _ (até 30)." };
  }
  if (value.conta.nascimento) {
    const m = BIRTH_RE.exec(value.conta.nascimento);
    const date = m ? new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1])) : null;
    if (!m || !date || date.getDate() !== Number(m[1]) || date.getMonth() !== Number(m[2]) - 1) {
      return { error: "Data de nascimento no formato dd/mm/aaaa." };
    }
  }
  return { value };
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

export interface JobUpdate {
  id: string;
  /** undefined = o agente não mexeu; número = a cópia criada. */
  instanceIndex: number | undefined;
  steps: JobStep[];
  status: "running" | "done" | "error";
  error: string | null;
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
    });
  }
  return out;
}
