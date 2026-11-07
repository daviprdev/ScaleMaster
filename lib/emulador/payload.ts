import type { AgentMedia, EmulatorInstance, EmulatorTask, InstanceState } from "./types";

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

/** Nome de instância no MuMu: letras, números, espaço, ponto, _ e -, até 40. Vazio = inválido. */
export function instanceName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const name = value.replace(/[^\p{L}\p{N} ._-]/gu, "").replace(/\s+/g, " ").trim().slice(0, 40);
  return name || null;
}

export function shortText(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  return text ? text.slice(0, max) : null;
}

/** Tipo do agente que fez o sync: 'mumu' (PC do dono) ou 'vps' (agente-vps/). Ausente ou inesperado = MuMu. */
export function parseAgentKind(raw: unknown): "mumu" | "vps" {
  return raw === "vps" ? "vps" : "mumu";
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

/** Created do container (RFC3339 do docker inspect, com nanossegundos) como veio: só confere o formato e corta em 40, sem passar por Date. */
const CRIADA_RE = /^\d{4}-\d{2}-\d{2}T[\d:.]+Z?$/;
export function parseCriada(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const texto = raw.trim();
  return CRIADA_RE.test(texto) ? texto.slice(0, 40) : null;
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
      alert: shortText(r.alert, 120),
      criada: parseCriada(r.criada),
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

const MAX_MEDIA = 500;
/** Caminho relativo seguro: sem subir de pasta, sem disco nem barra no começo. */
const MEDIA_PATH_RE = /^(?!.*(^|\/)\.\.(\/|$))[^\:*?"<>|]{1,300}$/;

/** Mídias da pasta do MuMu que o agente listou (root = a pasta no PC, só para mostrar). */
export function parseMedia(raw: unknown): AgentMedia {
  const r = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const files: AgentMedia["files"] = [];
  const seen = new Set<string>();
  for (const item of Array.isArray(r.files) ? r.files.slice(0, MAX_MEDIA) : []) {
    if (!item || typeof item !== "object") continue;
    const f = item as Record<string, unknown>;
    if (typeof f.path !== "string" || !MEDIA_PATH_RE.test(f.path) || f.path.startsWith("/") || seen.has(f.path)) continue;
    if (f.tipo !== "imagem" && f.tipo !== "video") continue;
    seen.add(f.path);
    files.push({ path: f.path, size: typeof f.size === "number" && f.size >= 0 ? Math.round(f.size) : 0, tipo: f.tipo });
  }
  return { root: shortText(r.root, 300), files };
}
