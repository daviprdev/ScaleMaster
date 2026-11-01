/** Aba Emulador: agente do MuMu no PC (agente-mumu/) ↔ SaaS. SQL em supabase/emulador_agente.sql. */

import type { EmulatorJob } from "./jobs";

/** off = desligada, starting = processo de pé e Android subindo, on = Android pronto. */
export type InstanceState = "off" | "starting" | "on";

export interface EmulatorInstance {
  index: number;
  name: string;
  state: InstanceState;
}

/** Automação que o agente sabe rodar (pasta agente-mumu/tarefas/). */
export interface EmulatorTask {
  name: string;
  label: string;
  description: string | null;
}

export type CommandAction = "launch" | "shutdown" | "task" | "rename";
export type CommandStatus = "queued" | "running" | "done" | "error";

export interface EmulatorCommand {
  id: string;
  agentId: string;
  instanceIndex: number;
  action: CommandAction;
  task: string | null;
  status: CommandStatus;
  error: string | null;
  result: unknown;
  createdAt: string;
  finishedAt: string | null;
}

export interface EmulatorAgent {
  id: string;
  hostname: string | null;
  online: boolean;
  lastSeenAt: string | null;
  agentVersion: string | null;
  mumuVersion: string | null;
  mumuError: string | null;
  instances: EmulatorInstance[];
  tasks: EmulatorTask[];
  createdAt: string;
}

export interface EmuladorResponse {
  /** false = supabase/emulador_agente.sql ainda não aplicado. */
  available: boolean;
  agents: EmulatorAgent[];
  /** Comandos das últimas 24 h, do mais novo para o mais velho. */
  commands: EmulatorCommand[];
  /** false = supabase/emulador_contas.sql ainda não aplicado (sem Nova conta). */
  jobsAvailable: boolean;
  /** Contas da fila Nova conta, da mais nova para a mais velha. */
  jobs: EmulatorJob[];
}
