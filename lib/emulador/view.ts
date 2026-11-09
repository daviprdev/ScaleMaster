import { PC_INDEX } from "./payload";
import type { EmulatorCommand, EmulatorTask } from "./types";

/** Erro/resultado de comando some da linha depois disso (continua no banco). */
export const RECENT_OUTCOME_MS = 10 * 60_000;

export function instanceKey(agentId: string, index: number): string {
  return `${agentId}:${index}`;
}

/** Comando mais novo de cada instância. `commands` vem do mais novo para o mais velho. */
export function latestCommandByInstance(commands: readonly EmulatorCommand[]): Map<string, EmulatorCommand> {
  const out = new Map<string, EmulatorCommand>();
  for (const c of commands) {
    const key = instanceKey(c.agentId, c.instanceIndex);
    if (!out.has(key)) out.set(key, c);
  }
  return out;
}

export function isActive(command: EmulatorCommand | undefined): boolean {
  return command?.status === "queued" || command?.status === "running";
}

export function taskLabel(name: string | null, tasks: readonly EmulatorTask[]): string {
  return tasks.find((t) => t.name === name)?.label ?? name ?? "automação";
}

/** Texto curto do que o comando está fazendo agora. */
export function activeText(command: EmulatorCommand, tasks: readonly EmulatorTask[]): string {
  if (command.status === "queued") return "Enviando para o PC…";
  if (command.action === "launch") return command.instanceIndex === PC_INDEX ? "Abrindo o MuMu…" : "Abrindo…";
  if (command.action === "shutdown") return "Fechando…";
  if (command.action === "rename") return "Renomeando…";
  if (command.action === "delete") return "Excluindo do MuMu…";
  return `Rodando ${taskLabel(command.task, tasks)}…`;
}

/** "agora", "há 40 s", "há 5 min", "há 3 h", "há 2 dias". */
export function timeAgo(iso: string | null, now = Date.now()): string {
  if (!iso) return "nunca";
  const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (s < 5) return "agora";
  if (s < 60) return `há ${s} s`;
  const m = Math.round(s / 60);
  if (m < 60) return `há ${m} min`;
  const h = Math.round(m / 60);
  if (h < 48) return `há ${h} h`;
  return `há ${Math.round(h / 24)} dias`;
}

/** Resultado de automação em "chave: valor" (só valores simples, até 6). */
export function resultPairs(result: unknown): Array<[string, string]> {
  if (!result || typeof result !== "object" || Array.isArray(result)) return [];
  return Object.entries(result as Record<string, unknown>)
    .filter(([, v]) => ["string", "number", "boolean"].includes(typeof v))
    .slice(0, 6)
    .map(([k, v]) => [k, String(v)]);
}

/** Máscara dd/mm/aaaa: fica só com os dígitos (até 8) e põe as barras sozinha conforme o dono digita. */
export function mascaraData(valor: string): string {
  const d = valor.replace(/[^0-9]/g, "").slice(0, 8);
  if (d.length <= 2) return d;
  if (d.length <= 4) return d.slice(0, 2) + "/" + d.slice(2);
  return d.slice(0, 2) + "/" + d.slice(2, 4) + "/" + d.slice(4);
}
