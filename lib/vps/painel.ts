import { ALERTA_ROBO, type JobStatus } from "@/lib/emulador/jobs";
import type { VpsJob } from "./types";

/**
 * Painel "Progresso" e "Log" da aba Contas VPS: tudo calculado no cliente a
 * partir dos jobs que o polling de 3 s já traz. Funções puras (testadas em
 * __tests__/vps-painel.test.ts); o componente é ProgressoLotePanel.
 */

/** Texto do aviso de captcha no card e no log (o job guarda ALERTA_ROBO; aqui é só o rótulo). */
export const ROTULO_CAPTCHA = "Captcha: confirme que você é uma pessoa";

/** Rótulo de exibição de um erro de conta: o captcha ganha texto próprio; o resto sai como veio. */
export function rotuloAlerta(error: string | null | undefined): string | null {
  if (!error) return null;
  return error === ALERTA_ROBO ? ROTULO_CAPTCHA : error;
}

export interface LoteAtivo {
  loteId: string;
  /** Todas as contas do lote (fila, rodando, criadas e paradas), da mais antiga para a mais nova. */
  jobs: VpsJob[];
}

/**
 * "Rodada atual": o lote mais recente (pela conta mais nova) que ainda tem
 * conta na fila ou rodando. null = nenhum lote ativo (o painel fica na tela, zerado).
 */
export function loteAtual(jobs: readonly VpsJob[]): LoteAtivo | null {
  const pendentes = jobs.filter((j) => j.loteId && (j.status === "queued" || j.status === "running"));
  if (pendentes.length === 0) return null;
  const maisRecente = pendentes.reduce((a, b) => (Date.parse(b.createdAt) > Date.parse(a.createdAt) ? b : a));
  const loteId = maisRecente.loteId as string;
  const doLote = jobs.filter((j) => j.loteId === loteId).sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
  return { loteId, jobs: doLote };
}

export type Contadores = Record<JobStatus, number>;

/** Na fila / Rodando / Criadas / Falhas do lote. */
export function contadoresDoLote(jobs: readonly VpsJob[]): Contadores {
  const c: Contadores = { queued: 0, running: 0, done: 0, error: 0 };
  for (const j of jobs) c[j.status] += 1;
  return c;
}

/** "45.181.53.233:10000" → "45.181.x.x:10000"; hostname fica como está. null/"" → null. */
export function mascararProxy(hostPorta: string | null | undefined): string | null {
  const texto = String(hostPorta ?? "").trim();
  if (!texto) return null;
  const m = /^(\d{1,3})\.(\d{1,3})\.\d{1,3}\.\d{1,3}(:\d+)?$/.exec(texto);
  if (m) return `${m[1]}.${m[2]}.x.x${m[3] ?? ""}`;
  return texto;
}

/** Proxies distintas do lote (mascaradas), na ordem em que aparecem. */
export function proxiesDoLote(jobs: readonly VpsJob[]): string[] {
  const vistas = new Set<string>();
  const saida: string[] = [];
  for (const j of jobs) {
    const p = mascararProxy(j.proxyHost);
    if (!p || vistas.has(p)) continue;
    vistas.add(p);
    saida.push(p);
  }
  return saida;
}

export interface LinhaLog {
  id: string;
  hora: string;
  /** @ da conta (label do job). */
  conta: string;
  etapa: string;
  mensagem: string;
  erro: boolean;
}

interface RetratoJob {
  status: JobStatus;
  error: string | null;
  prompt: string | null;
  steps: Map<string, string>;
}

/** O que já foi visto de cada conta, para o próximo polling só registrar o que mudou. */
export type Retrato = Map<string, RetratoJob>;

export const LOG_MAX = 300;

function chaveStep(status: string, message: string | null): string {
  return `${status}|${message ?? ""}`;
}

export function retratar(jobs: readonly VpsJob[]): Retrato {
  const r: Retrato = new Map();
  for (const j of jobs) {
    r.set(j.id, {
      status: j.status,
      error: j.error,
      prompt: j.prompt?.texto ?? null,
      steps: new Map(j.steps.map((s) => [s.key, chaveStep(s.status, s.message)])),
    });
  }
  return r;
}

function hora(agora: Date): string {
  return agora.toTimeString().slice(0, 8);
}

/**
 * Linhas novas do log a partir do que mudou entre o retrato anterior e os
 * jobs de agora: etapa que começou, terminou ou falhou, aviso da conta,
 * pedido ao dono e conta criada. Sem retrato anterior (primeira leitura) só
 * registra o estado atual que interessa: etapa rodando, erro e pedido.
 * `rotulos` = chave da etapa → rótulo (VPS_FLUXO).
 */
export function diferencasDeLog(antes: Retrato | null, jobs: readonly VpsJob[], agora: Date, rotulos: ReadonlyMap<string, string>): LinhaLog[] {
  const linhas: LinhaLog[] = [];
  const h = hora(agora);
  let n = 0;
  const linha = (job: VpsJob, etapa: string, mensagem: string, erro: boolean) =>
    linhas.push({ id: `${job.id}:${agora.getTime()}:${n++}`, hora: h, conta: job.label ?? job.id.slice(0, 8), etapa, mensagem, erro });

  for (const job of jobs) {
    const prev = antes?.get(job.id) ?? null;
    for (const s of job.steps) {
      const chave = chaveStep(s.status, s.message);
      if (prev && prev.steps.get(s.key) === chave) continue;
      if (!prev && s.status === "done") continue;
      const rotulo = rotulos.get(s.key) ?? s.key;
      if (s.status === "running") linha(job, rotulo, "…", false);
      else if (s.status === "done") linha(job, rotulo, `ok${s.message ? ` · ${s.message}` : ""}`, false);
      else if (s.status === "error") linha(job, rotulo, s.message ?? "falhou", true);
    }
    if (job.error && job.error !== (prev?.error ?? null)) linha(job, "conta", rotuloAlerta(job.error) ?? job.error, true);
    const pedido = job.prompt?.texto ?? null;
    if (pedido && pedido !== (prev?.prompt ?? null)) linha(job, "esperando você", pedido, false);
    if (job.status === "done" && prev && prev.status !== "done") linha(job, "conta", "Conta criada", false);
  }
  return linhas;
}

/** Junta as linhas novas mantendo só as últimas LOG_MAX em memória. */
export function acrescentarLog(atual: readonly LinhaLog[], novas: readonly LinhaLog[]): LinhaLog[] {
  if (novas.length === 0) return atual as LinhaLog[];
  const juntas = [...atual, ...novas];
  return juntas.length > LOG_MAX ? juntas.slice(juntas.length - LOG_MAX) : juntas;
}
