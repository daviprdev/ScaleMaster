import { ALERTA_CAPTCHA, ALERTA_TELEFONE, MAX_JOB_UPDATES, type EmulatorJob, type JobStep } from "@/lib/emulador/jobs";
import type { VpsCapacidade, VpsJob } from "./types";

/**
 * Fila da aba Contas VPS: etapas, avisos, ligação conta ↔ container e a
 * identidade de aparelho que o servidor gera para cada conta. O lado da VPS
 * fica em agente-vps/fluxos/nova-conta.mjs (mesmas chaves de etapa).
 */

/** Etapas na ordem (iguais às de agente-vps/fluxos/nova-conta.mjs). */
export const VPS_FLUXO: ReadonlyArray<{ key: string; label: string }> = [
  { key: "copiar", label: "Criar o container a partir da imagem base" },
  { key: "ids", label: "Android ID, serial e MAC" },
  { key: "fingerprint", label: "Aplicar o perfil do aparelho" },
  { key: "geo", label: "Validar a proxy e o país" },
  { key: "nome", label: "Dar o nome da conta ao container" },
  { key: "abrir", label: "Ligar o container" },
  { key: "instagram", label: "Instalar o Instagram (APK pinado)" },
  { key: "rede", label: "Subir a proxy no container (redsocks)" },
  { key: "limpar", label: "Preparar o Instagram para o cadastro" },
  { key: "email", label: "Conferir a caixa de e-mail" },
  { key: "cadastro", label: "Criar a conta no Instagram" },
  { key: "perfil", label: "Foto, nome de exibição e bio" },
  { key: "seguir", label: "Aquecer: seguir perfis verificados" },
  { key: "reels", label: "Aquecer: rolar os Reels" },
  { key: "sessao", label: "Exportar a sessão" },
  { key: "fechar", label: "Desligar o container" },
];

/** Automação do agente da VPS que roda scripts/vps/golden.sh (agente-vps/tarefas/); pedida por POST /api/vps/imagem. */
export const TAREFA_GOLDEN = "rebuild-imagem";

export const VPS_FLUXO_KEYS: ReadonlyArray<string> = VPS_FLUXO.map((s) => s.key);

/** Proxy que não respondeu (ou país errado) na validação: a conta para e fica pausada. */
export const PROXY_MORTA = "PROXY_MORTA: a proxy não respondeu ou é de outro país";

const ALERTAS: ReadonlySet<string> = new Set([ALERTA_TELEFONE, ALERTA_CAPTCHA, PROXY_MORTA]);

export function ehAlertaVps(error: string | null | undefined): error is string {
  return !!error && ALERTAS.has(error);
}

export function ehProxyMorta(error: string | null | undefined): boolean {
  return !!error && error.startsWith("PROXY_MORTA");
}

/** Índice da etapa em andamento (ou da última concluída) e o percentual para a barra. */
export function progresso(job: Pick<EmulatorJob, "steps" | "status">): { etapa: string | null; label: string; pct: number } {
  const feitas = new Set(job.steps.filter((s) => s.status === "done").map((s) => s.key));
  const atual = job.steps.find((s) => s.status === "running") ?? job.steps.find((s) => s.status === "error") ?? null;
  const total = VPS_FLUXO.length;
  const concluidas = VPS_FLUXO.filter((s) => feitas.has(s.key)).length;
  if (job.status === "done") return { etapa: null, label: "Conta criada", pct: 100 };
  const def = atual ? VPS_FLUXO.find((s) => s.key === atual.key) : null;
  const pct = Math.round((concluidas / total) * 100);
  return { etapa: atual?.key ?? null, label: def?.label ?? (job.status === "queued" ? "Na fila" : "Parou"), pct };
}

/**
 * A conta mais nova de cada container de uma VPS (`jobs` vem da mais nova
 * para a mais velha). Liga pelo nome que a etapa "nome" deu ao container
 * (o índice pode ser reaproveitado depois de excluir).
 */
export function linkedJobs(
  jobs: readonly VpsJob[],
  agentId: string,
  instances: ReadonlyArray<{ index: number; name: string }>
): Map<number, VpsJob> {
  const out = new Map<number, VpsJob>();
  for (const job of jobs) {
    if (job.kind !== "nova-conta" || job.agentId !== agentId || job.instanceIndex === null) continue;
    const nome = job.steps.find((s) => s.key === "nome")?.message;
    const inst = instances.find((i) => i.index === job.instanceIndex);
    const ligada = nome ? inst?.name === nome : job.status === "queued" || job.status === "running";
    if (inst && ligada && !out.has(inst.index)) out.set(inst.index, job);
  }
  return out;
}

/** Containers de uma VPS com algo na fila ou rodando. */
export function busyInstances(jobs: readonly VpsJob[], agentId: string): Set<number> {
  const out = new Set<number>();
  for (const job of jobs) {
    if (job.agentId === agentId && job.instanceIndex !== null && (job.status === "queued" || job.status === "running")) {
      out.add(job.instanceIndex);
    }
  }
  return out;
}

/** Aviso em vermelho por container: proxy morta, telefone ou captcha. */
export function instanceAlerts(
  jobs: readonly VpsJob[],
  agentId: string,
  instances: ReadonlyArray<{ index: number; name: string }>
): Map<number, string> {
  const out = new Map<number, string>();
  for (const [index, job] of linkedJobs(jobs, agentId, instances)) {
    if (ehAlertaVps(job.error)) out.set(index, job.error);
  }
  return out;
}

/** Contas na fila ou rodando numa VPS (para a capacidade). */
export function activeCount(jobs: readonly VpsJob[], agentId: string): number {
  return jobs.filter((j) => j.agentId === agentId && (j.status === "queued" || j.status === "running")).length;
}

/** Capacidade com os limites de segurança quando a VPS ainda não informou. */
export function parseCapacidade(raw: unknown): VpsCapacidade {
  const r = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const int = (v: unknown, min: number, max: number, padrao: number) =>
    typeof v === "number" && Number.isFinite(v) ? Math.min(max, Math.max(min, Math.round(v))) : padrao;
  const versoes = Array.isArray(r.versoesIg)
    ? r.versoesIg.filter((v): v is string => typeof v === "string" && /^[0-9][0-9A-Za-z.\-_]{0,30}$/.test(v)).slice(0, 20)
    : [];
  return {
    maxLigadas: int(r.maxLigadas, 1, 200, 2),
    maxCadastro: int(r.maxCadastro, 1, MAX_JOB_UPDATES, 2),
    ramTotalMb: int(r.ramTotalMb, 0, 1_000_000, 0),
    ramUsadaMb: int(r.ramUsadaMb, 0, 1_000_000, 0),
    ligadas: int(r.ligadas, 0, 200, 0),
    versoesIg: versoes,
  };
}

/** "Continuar" depois de uma proxy morta: a etapa geo roda de novo (as anteriores ficam). */
export function stepsAfterProxyChange(steps: readonly JobStep[]): JobStep[] {
  const refazer = new Set(["geo", "rede", "limpar", "email", "cadastro", "perfil", "seguir", "reels", "sessao"]);
  return steps.filter((s) => s.status === "done" && !refazer.has(s.key));
}
