import type { EmulatorInstance, EmulatorTask, InstanceState } from "./types";

/**
 * Leitura defensiva do que o agente manda em /api/emulador/agente/sync. O
 * agente roda no PC e o código dele dá acesso só a esta rota, mas o corpo
 * ainda é entrada externa: tudo é recortado em tipo e tamanho antes de ir
 * para o banco ou para a tela.
 */

/** Agente sem sync há mais que isso aparece como offline (ele chama a cada ~3 s). */
export const AGENT_ONLINE_MS = 20_000;

/**
 * "Instância" -1 = o MuMu em si, não uma instância: launch nela abre só a
 * janela principal do MuMu (MuMuManager main launch), sem ligar nenhuma.
 */
export const PC_INDEX = -1;

/** Comando que ficou na fila mais que isso não roda mais (o PC estava fora). */
export const QUEUED_COMMAND_TTL_MS = 2 * 60_000;

const MAX_INSTANCES = 200;
const MAX_TASKS = 50;
const MAX_RESULTS = 50;
const MAX_RESULT_JSON = 20_000;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const TASK_NAME_RE = /^[a-z0-9][a-z0-9-]{0,39}$/;
const STATES: ReadonlySet<string> = new Set<InstanceState>(["off", "starting", "on"]);

export function shortText(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  return text ? text.slice(0, max) : null;
}

export function isOnline(lastSeenAt: string | null | undefined, now = Date.now()): boolean {
  if (!lastSeenAt) return false;
  const t = Date.parse(lastSeenAt);
  return Number.isFinite(t) && now - t < AGENT_ONLINE_MS;
}

function asIndex(value: unknown): number | null {
  const n = typeof value === "string" && value.trim() !== "" ? Number(value) : value;
  return typeof n === "number" && Number.isInteger(n) && n >= 0 && n < 10_000 ? n : null;
}

export function parseInstances(raw: unknown): EmulatorInstance[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<number>();
  const out: EmulatorInstance[] = [];
  for (const item of raw.slice(0, MAX_INSTANCES)) {
    if (!item || typeof item !== "object") continue;
    const r = item as Record<string, unknown>;
    const index = asIndex(r.index);
    if (index === null || seen.has(index)) continue;
    seen.add(index);
    out.push({
      index,
      name: shortText(r.name, 80) ?? `Instância ${index}`,
      state: typeof r.state === "string" && STATES.has(r.state) ? (r.state as InstanceState) : "off",
    });
  }
  return out.sort((a, b) => a.index - b.index);
}

export function parseTasks(raw: unknown): EmulatorTask[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: EmulatorTask[] = [];
  for (const item of raw.slice(0, MAX_TASKS)) {
    if (!item || typeof item !== "object") continue;
    const r = item as Record<string, unknown>;
    if (typeof r.name !== "string" || !TASK_NAME_RE.test(r.name) || seen.has(r.name)) continue;
    seen.add(r.name);
    out.push({
      name: r.name,
      label: shortText(r.label, 60) ?? r.name,
      description: shortText(r.description, 200),
    });
  }
  return out;
}

export interface CommandResult {
  id: string;
  status: "done" | "error";
  error: string | null;
  result: unknown;
}

/** Só JSON pequeno entra no banco; o que passar disso vira um aviso. */
function boundedJson(value: unknown): unknown {
  if (value === undefined) return null;
  try {
    const text = JSON.stringify(value);
    if (text === undefined) return null;
    return text.length <= MAX_RESULT_JSON ? JSON.parse(text) : { aviso: "Resultado grande demais para guardar." };
  } catch {
    return null;
  }
}

export function parseResults(raw: unknown): CommandResult[] {
  if (!Array.isArray(raw)) return [];
  const out: CommandResult[] = [];
  for (const item of raw.slice(0, MAX_RESULTS)) {
    if (!item || typeof item !== "object") continue;
    const r = item as Record<string, unknown>;
    if (typeof r.id !== "string" || !UUID_RE.test(r.id)) continue;
    if (r.status !== "done" && r.status !== "error") continue;
    out.push({
      id: r.id,
      status: r.status,
      error: r.status === "error" ? (shortText(r.error, 500) ?? "Erro sem mensagem.") : null,
      result: boundedJson(r.result),
    });
  }
  return out;
}

/** IDs dos comandos que o agente ainda está executando. */
export function parseRunning(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((id): id is string => typeof id === "string" && UUID_RE.test(id)).slice(0, 100);
}
