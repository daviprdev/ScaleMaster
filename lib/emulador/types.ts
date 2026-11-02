/** Aba Emulador: agente do MuMu no PC (agente-mumu/) ↔ SaaS. SQL em supabase/emulador_agente.sql. */

import type { MediaFile } from "./atividade";
import type { EmulatorJob } from "./jobs";

/** off = desligada, starting = processo de pé e Android subindo, on = Android pronto. */
export type InstanceState = "off" | "starting" | "on";

export interface EmulatorInstance {
  index: number;
  name: string;
  state: InstanceState;
  /** Aviso que o agente guarda para a instância (ex.: conta travada pedindo telefone). */
  alert: string | null;
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
  /** Fotos e vídeos da pasta do MuMu no PC (para o Estruturar). */
  media: AgentMedia;
  createdAt: string;
}

/** Pasta de mídias do MuMu no PC: o caminho (só para mostrar) e os arquivos achados. */
export interface AgentMedia {
  root: string | null;
  files: MediaFile[];
}

export interface EmuladorResponse {
  /** false = supabase/emulador_agente.sql ainda não aplicado. */
  available: boolean;
  agents: EmulatorAgent[];
  /** Comandos das últimas 24 h, do mais novo para o mais velho. */
  commands: EmulatorCommand[];
  /** false = supabase/emulador_contas.sql ainda não aplicado (sem Nova conta). */
  jobsAvailable: boolean;
  /** false = supabase/emulador_atividade.sql ainda não aplicado (sem o botão Atividade). */
  atividadeAvailable: boolean;
  /** Contas da fila Nova conta, da mais nova para a mais velha. */
  jobs: EmulatorJob[];
}
