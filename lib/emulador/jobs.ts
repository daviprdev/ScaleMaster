import type { AtividadeAcao } from "./atividade";
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

/** nova-conta = Criar instância / Criar conta aqui; atividade = botão Atividade (lib/emulador/atividade.ts). */
export type JobKind = "nova-conta" | "atividade";

export interface EmulatorJob {
  id: string;
  agentId: string;
  kind: JobKind;
  /** Só atividade: o que foi marcado (as etapas da tela saem daqui). */
  acoes: AtividadeAcao[];
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
 * Fim da conta quando o Instagram trava numa tela que a automação não resolve:
 * o agente desliga a instância e a conta termina com um destes erros exatos
 * (iguais aos de agente-mumu/fluxos/cadastro.mjs). A aba mostra em vermelho na
 * linha da instância. Continuar religa a instância, reconecta a proxy e volta
 * ao cadastro: se a tela ainda estiver lá, encerra de novo com o aviso.
 */
export const ALERTA_TELEFONE = "Conta ERRO CRIAÇÃO, verificar com numero telefone";
/** Captcha "Confirma que és uma pessoa" (código da imagem), pedido do dono em 02/11. */
export const ALERTA_CAPTCHA = "Conta ERRO CRIAÇÃO, verificar captcha";
/** Contas VPS: captcha/verificação de humano — a conta é descartada (container e volume apagados) e a aba mostra isto em vermelho. */
export const ALERTA_ROBO = "Confirme que você não é um robô";
/** Contas VPS: o Instagram recusou 5 @ seguidos — a conta é descartada. */
export const ALERTA_USUARIO = "Usuário recusado pelo Instagram 5 vezes";
const ALERTAS_CRIACAO: ReadonlySet<string> = new Set([ALERTA_TELEFONE, ALERTA_CAPTCHA]);
/** Erros que descartam a conta da VPS: sem Continuar, só "Tentar de novo" (device e proxy novos). */
const ALERTAS_DESCARTE: ReadonlySet<string> = new Set([ALERTA_ROBO, ALERTA_USUARIO]);

export function ehDescarte(error: string | null | undefined): error is string {
  return !!error && ALERTAS_DESCARTE.has(error);
}

export function ehAlertaCriacao(error: string | null | undefined): error is string {
  return !!error && ALERTAS_CRIACAO.has(error);
}

/**
 * A conta mais nova de cada instância de um PC (`jobs` vem da mais nova para a
 * mais velha). O MuMu reaproveita índices de instância apagada, então a ligação
 * só vale se a instância ainda tem o nome que a conta deu a ela (etapa "nome").
 */
export function linkedJobs(
  jobs: readonly EmulatorJob[],
  agentId: string,
  instances: ReadonlyArray<{ index: number; name: string }>
): Map<number, EmulatorJob> {
  const out = new Map<number, EmulatorJob>();
  for (const job of jobs) {
    if (job.kind !== "nova-conta" || job.agentId !== agentId || job.instanceIndex === null) continue;
    const nome = job.steps.find((s) => s.key === "nome")?.message;
    const inst = instances.find((i) => i.index === job.instanceIndex);
    // Sem a etapa nome ainda (Criar conta aqui na fila): vale pelo índice enquanto não terminou.
    const ligada = nome ? inst?.name === nome : job.status === "queued" || job.status === "running";
    if (inst && ligada && !out.has(inst.index)) out.set(inst.index, job);
  }
  return out;
}

/** Instâncias de um PC com alguma coisa na fila ou rodando (conta ou atividade). */
export function busyInstances(jobs: readonly EmulatorJob[], agentId: string): Set<number> {
  const out = new Set<number>();
  for (const job of jobs) {
    if (job.agentId === agentId && job.instanceIndex !== null && (job.status === "queued" || job.status === "running")) {
      out.add(job.instanceIndex);
    }
  }
  return out;
}

/** Aviso em vermelho por instância: a conta dela travou (telefone, captcha). */
export function instanceAlerts(
  jobs: readonly EmulatorJob[],
  agentId: string,
  instances: ReadonlyArray<{ index: number; name: string }>
): Map<number, string> {
  const out = new Map<number, string>();
  for (const [index, job] of linkedJobs(jobs, agentId, instances)) {
    if (ehAlertaCriacao(job.error)) out.set(index, job.error);
  }
  return out;
}

/**
 * "Criar conta aqui": a conta nasce numa instância que já existe, então copiar
 * e trocar IDs ficam marcados como feitos (o agente pula). O resto roda.
 */
export const STEPS_CONTA_AQUI: JobStep[] = [
  { key: "copiar", status: "done", message: "instância já existente" },
  { key: "ids", status: "done", message: "mantidos" },
];

/**
 * Editar dados numa instância que não tem conta do sistema: o dono anota os
 * dados da conta que já está nela. A linha nasce como "done" com a etapa
 * "registro" (nada roda no PC) e a "nome" com o nome atual, que liga a linha à
 * instância (linkedJobs).
 */
export const STEP_REGISTRO = "registro";

export function registroSteps(instanceName: string): JobStep[] {
  return [
    { key: STEP_REGISTRO, status: "done", message: "dados anotados à mão" },
    { key: "nome", status: "done", message: instanceName },
  ];
}

export function isRegistro(job: EmulatorJob): boolean {
  return job.steps.some((s) => s.key === STEP_REGISTRO);
}

/**
 * Editar nome: a etapa "nome" passa do nome antigo para o novo, para os dados
 * continuarem ligados à instância. null = a conta não tinha esse nome.
 */
export function renameNomeStep(steps: readonly JobStep[], anterior: string, nome: string): JobStep[] | null {
  if (!steps.some((s) => s.key === "nome" && s.message === anterior)) return null;
  return steps.map((s) => (s.key === "nome" ? { ...s, message: nome } : s));
}

/**
 * Dá para salvar dados novos (atividade não tem Editar). Rodando: a tela só
 * mostra. Na fila ou parada, salvar devolve à fila; criada, salvar só guarda.
 */
export function canEditJob(job: EmulatorJob): boolean {
  return job.kind === "nova-conta" && job.status !== "running";
}

/** Etapas na ordem. O Instagram baixa antes da proxy para os 275 MB não passarem por ela. */
export const NOVA_CONTA_FLUXO: ReadonlyArray<{ key: string; label: string }> = [
  { key: "copiar", label: "Copiar a instância padrão" },
  { key: "ids", label: "Trocar IMEI, Android ID e MAC" },
  { key: "nome", label: "Dar o nome da conta à instância" },
  { key: "abrir", label: "Ligar a instância" },
  { key: "instagram", label: "Instalar o Instagram pelo Aurora" },
  { key: "proxy", label: "Proxy no NekoBox" },
  { key: "limpar", label: "Preparar o Instagram para o cadastro" },
  { key: "cadastro", label: "Criar a conta no Instagram" },
  { key: "seguir", label: "Aquecer: seguir perfis verificados" },
  { key: "reels", label: "Aquecer: rolar os Reels" },
  { key: "fechar", label: "Desligar a instância" },
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
  /** Contas VPS: @ que o Instagram aceitou quando o original foi recusado (vai para input_enc, label e vps_devices). */
  usuario?: string;
  /** Contas VPS: o agente já apagou container e volume (captcha / @ recusado 5 vezes). */
  descartada?: boolean;
}

const USUARIO_IG_RE = /^[a-z][a-z0-9._]{0,29}$/;

/** Teto de contas simultâneas que um agente pode reportar num sync (= maxCadastro máximo da VPS em lib/vps/jobs.ts). */
export const MAX_JOB_UPDATES = 50;

/** Andamento que o agente manda no sync, uma entrada por conta que mudou. */
export function parseJobUpdates(raw: unknown): JobUpdate[] {
  if (!Array.isArray(raw)) return [];
  const out: JobUpdate[] = [];
  for (const item of raw.slice(0, MAX_JOB_UPDATES)) {
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
      ...(typeof r.usuario === "string" && USUARIO_IG_RE.test(r.usuario) ? { usuario: r.usuario } : {}),
      ...(r.descartada === true ? { descartada: true } : {}),
    });
  }
  return out;
}
