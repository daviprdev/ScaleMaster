/**
 * Pausa automática de conta pelo limite de publicação da Meta.
 *
 * Dois freios diferentes da Meta, os dois numa janela MÓVEL de 24h (cada post
 * libera a vaga exatamente 24h depois de publicado — não zera à meia-noite):
 *
 *   1. Cota OFICIAL da Content Publishing API — GET /{ig-user-id}/content_publishing_limit
 *      devolve { quota_usage, config: { quota_total: 100, quota_duration: 86400 } }.
 *      Conferida ANTES de publicar: conta com a cota cheia nem tenta.
 *
 *   2. Freio antispam ("User is performing too many actions"). Não aparece na
 *      cota: medido em 2026-10-19, 21 contas recusadas com exatamente 50 posts
 *      em 24h e quota_usage 50/100. Só dá para saber reagindo à recusa.
 *
 * Nos dois casos a conta fica PAUSADA até o post mais antigo da janela de 24h
 * completar 24h (a próxima vaga) e volta sozinha para a fila. Antes, cada post
 * recusado era tentado de novo a cada 2–5 min — 777 recusas numa hora —, o que
 * ocupava o lote dos crons e atrasava as outras contas.
 *
 * Estado em memória do processo (globalThis: compartilhado por todas as rotas
 * do servidor). Um restart só faz cada conta pausada ser tentada mais uma vez
 * e pausar de novo — sem tabela nova nem migração.
 */

import { fetch as undiciFetch } from "undici";

const GRAPH_API = "https://graph.instagram.com/v21.0";
const H = 60 * 60_000;
const WINDOW_MS = 24 * H;
/** Folga depois da vaga liberar: a Meta conta a janela pelo lado dela. */
const RELEASE_SLACK_MS = 60_000;
/** Freio antispam: nunca menos que isto (não martelar) nem mais que isto (re-tenta). */
export const ACTION_PAUSE_MIN_MS = 15 * 60_000;
export const ACTION_PAUSE_MAX_MS = 6 * H;
/** Sem o histórico de posts para calcular a vaga. */
export const FALLBACK_PAUSE_MS = 30 * 60_000;
const QUOTA_CACHE_MS = 10 * 60_000;

export type PauseCause = "quota" | "action";

export interface PublishPause {
  until: string;
  cause: PauseCause;
  /** Texto para o painel e para o log. */
  reason: string;
  posts24h: number | null;
  quotaUsage: number | null;
  quotaTotal: number | null;
  since: string;
}

export interface LimitAccount {
  id: string;
  username: string;
  igUserId: string;
  token: string;
}

interface Quota { usage: number; total: number; at: number }

const g = globalThis as typeof globalThis & {
  __smPublishPauses?: Map<string, PublishPause>;
  __smPublishQuota?: Map<string, Quota>;
};
const pauses = (g.__smPublishPauses ??= new Map());
const quotas = (g.__smPublishQuota ??= new Map());

/** Recusa da Meta por limite (antispam ou cota). */
export function isMetaLimitError(msg: string): boolean {
  return /too many actions|performing too many|publishing limit|maximum number of (api )?posts|2207042/i.test(msg);
}

/** Recusa por COTA oficial (as demais recusas de limite são o freio antispam). */
function isQuotaError(msg: string): boolean {
  return /publishing limit|maximum number of (api )?posts|2207042/i.test(msg);
}

/**
 * Até quando pausar. Pura: `recentPostTimes` são os horários (ms) dos posts
 * recentes da conta, em qualquer ordem.
 */
export function computePauseUntil(input: {
  cause: PauseCause;
  now: number;
  recentPostTimes: number[];
}): number {
  const { cause, now } = input;
  const inWindow = input.recentPostTimes.filter((t) => now - t < WINDOW_MS && t <= now);
  const release = inWindow.length ? Math.min(...inWindow) + WINDOW_MS + RELEASE_SLACK_MS : null;

  if (cause === "quota") {
    return release !== null && release > now ? release : now + FALLBACK_PAUSE_MS;
  }
  const target = release ?? now + FALLBACK_PAUSE_MS;
  return Math.min(Math.max(target, now + ACTION_PAUSE_MIN_MS), now + ACTION_PAUSE_MAX_MS);
}

/** Pausa ativa da conta, ou null. Pausa vencida é descartada aqui. */
export function getPublishPause(accountId: string, now = Date.now()): PublishPause | null {
  const p = pauses.get(accountId);
  if (!p) return null;
  if (Date.parse(p.until) <= now) {
    pauses.delete(accountId);
    return null;
  }
  return p;
}

/** Pausas ativas das contas informadas (painel). */
export function listPublishPauses(accountIds: string[]): Record<string, PublishPause> {
  const out: Record<string, PublishPause> = {};
  for (const id of accountIds) {
    const p = getPublishPause(id);
    if (p) out[id] = p;
  }
  return out;
}

/** Publicou: a cota em cache sobe 1 (evita reler a Meta a cada post). */
export function notePublished(accountId: string): void {
  const q = quotas.get(accountId);
  if (q) q.usage++;
}

async function graphGet(path: string, token: string): Promise<Record<string, unknown> | null> {
  try {
    const sep = path.includes("?") ? "&" : "?";
    const res = await undiciFetch(`${GRAPH_API}/${path}${sep}access_token=${encodeURIComponent(token)}`, {
      signal: AbortSignal.timeout(15_000),
    });
    const data = (await res.json()) as Record<string, unknown>;
    return res.ok && !data.error ? data : null;
  } catch {
    return null;
  }
}

/** Cota oficial (cache de 10 min). null = não deu para ler — não bloqueia. */
async function getQuota(acc: LimitAccount, fresh = false): Promise<Quota | null> {
  const cached = quotas.get(acc.id);
  if (!fresh && cached && Date.now() - cached.at < QUOTA_CACHE_MS) return cached;
  const data = await graphGet(`${acc.igUserId}/content_publishing_limit?fields=quota_usage,config`, acc.token);
  const row = (data?.data as { quota_usage?: number; config?: { quota_total?: number } }[] | undefined)?.[0];
  if (typeof row?.quota_usage !== "number" || typeof row.config?.quota_total !== "number") return null;
  const q = { usage: row.quota_usage, total: row.config.quota_total, at: Date.now() };
  quotas.set(acc.id, q);
  return q;
}

/** Horários dos posts mais recentes da conta (ms). Falha → []. */
async function recentPostTimes(acc: LimitAccount): Promise<number[]> {
  const data = await graphGet(`${acc.igUserId}/media?fields=timestamp&limit=100`, acc.token);
  return ((data?.data as { timestamp?: string }[] | undefined) ?? [])
    .map((m) => Date.parse(m.timestamp ?? ""))
    .filter((t) => Number.isFinite(t));
}

function hhmm(ms: number): string {
  return new Date(ms).toLocaleTimeString("pt-BR", {
    hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo",
  });
}

/**
 * Pausa a conta até a próxima vaga da janela de 24h. Chamada quando a Meta
 * recusa por limite (`errorMsg`) ou quando a cota oficial já está cheia.
 */
export async function pauseForMetaLimit(
  acc: LimitAccount,
  cause: PauseCause,
  errorMsg?: string
): Promise<PublishPause> {
  const effectiveCause: PauseCause = errorMsg && isQuotaError(errorMsg) ? "quota" : cause;
  const now = Date.now();
  const [times, quota] = await Promise.all([recentPostTimes(acc), getQuota(acc, true)]);
  const until = computePauseUntil({ cause: effectiveCause, now, recentPostTimes: times });
  const posts24h = times.length ? times.filter((t) => now - t < WINDOW_MS).length : null;

  const quotaText = quota ? `cota oficial ${quota.usage}/${quota.total}` : "cota oficial indisponível";
  const reason =
    effectiveCause === "quota"
      ? `Limite oficial da Meta atingido (${quotaText} em 24h). Volta às ${hhmm(until)}.`
      : `A Meta recusou por excesso de ações` +
        (posts24h !== null ? ` (${posts24h} posts nas últimas 24h; ${quotaText})` : ` (${quotaText})`) +
        `. Volta às ${hhmm(until)}.`;

  const pause: PublishPause = {
    until: new Date(until).toISOString(),
    cause: effectiveCause,
    reason,
    posts24h,
    quotaUsage: quota?.usage ?? null,
    quotaTotal: quota?.total ?? null,
    since: new Date(now).toISOString(),
  };
  pauses.set(acc.id, pause);
  console.warn(`[publish-limits] ⏸ @${acc.username} pausada: ${reason}`);
  return pause;
}

/**
 * Pode publicar agora? null = pode. Senão, a pausa (já existente ou criada
 * agora porque a cota oficial está cheia). Falha ao ler a cota não bloqueia.
 */
export async function checkPublishGate(acc: LimitAccount): Promise<PublishPause | null> {
  const active = getPublishPause(acc.id);
  if (active) return active;
  const quota = await getQuota(acc);
  if (quota && quota.usage >= quota.total) return pauseForMetaLimit(acc, "quota");
  return null;
}
