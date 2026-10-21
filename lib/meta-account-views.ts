/**
 * lib/meta-account-views.ts — Views REAIS de uma conta (insight de conta), por
 * dia UTC.
 *
 * GET /{ig-user-id}/insights?metric=views,reach&period=day&metric_type=total_value
 *     &since=<meia-noite UTC>&until=<meia-noite UTC + N dias>
 *
 * Por que por dia e alinhado em UTC: a soma de janelas diárias alinhadas à
 * meia-noite UTC bate exatamente com o total do período (medido em produção);
 * janelas desalinhadas se sobrepõem e contam em dobro. Guardar por dia permite
 * acumular o total além da janela aceita pela API.
 *
 * Endpoint oficial da Meta: conexão direta, sem proxy.
 */

import { fetch as undiciFetch } from "undici";

export const GRAPH_API = "https://graph.instagram.com/v21.0";
const DAY_S = 86_400;
// Limites de uso da Graph API + 80002 (freio por conta do Instagram).
export const RATE_LIMIT_CODES = new Set([4, 17, 32, 613, 80002]);

export class MetaRateLimitError extends Error {}

export interface WindowViews {
  views: number | null;
  reach: number | null;
}

/** Meia-noite UTC (em segundos) do dia `daysAgo` atrás. */
export function utcDayStart(daysAgo: number, nowMs = Date.now()): number {
  return Math.floor(nowMs / 1000 / DAY_S) * DAY_S - daysAgo * DAY_S;
}

export function utcDayIso(epochS: number): string {
  return new Date(epochS * 1000).toISOString().slice(0, 10);
}

/** Views/reach da conta numa janela [since, until) em segundos, alinhada a dias UTC. */
export async function fetchAccountWindow(
  igUserId: string,
  token: string,
  sinceS: number,
  untilS: number,
  metrics: "views" | "views,reach" = "views,reach"
): Promise<WindowViews> {
  const url =
    `${GRAPH_API}/${igUserId}/insights?metric=${metrics}&period=day&metric_type=total_value` +
    `&since=${sinceS}&until=${untilS}&access_token=${encodeURIComponent(token)}`;
  const res = await undiciFetch(url, { signal: AbortSignal.timeout(15_000) });
  let data: { data?: Array<{ name: string; total_value?: { value?: number } }>; error?: { code?: number; message?: string } } = {};
  try { data = (await res.json()) as typeof data; } catch { /* corpo não-JSON */ }

  if (!res.ok || data.error) {
    const code = data.error?.code;
    const msg = data.error?.message ?? `HTTP ${res.status}`;
    if (typeof code === "number" && RATE_LIMIT_CODES.has(code)) throw new MetaRateLimitError(msg);
    throw new Error(`code=${code ?? "-"} ${msg}`);
  }

  const get = (name: string): number | null => {
    const v = data.data?.find((m) => m.name === name)?.total_value?.value;
    return typeof v === "number" ? v : null;
  };
  return { views: get("views"), reach: get("reach") };
}

export interface DailyViewsRow {
  day: string; // YYYY-MM-DD (UTC)
  views: number;
  reach: number | null;
}

export interface DailyViewsResult {
  rows: DailyViewsRow[];
  /** Dias/blocos que a Meta recusou neste run — o chamador deve tentar de novo. */
  failures: number;
  lastError: string | null;
}

/**
 * A Meta devolve `code=10 Application does not have permission` de forma
 * INTERMITENTE em insights de conta (medido em produção: a mesma conta e a
 * mesma janela respondem ok minutos antes/depois, e numa mesma varredura um
 * dia falha e o vizinho não). Por isso uma falha isolada nunca derruba a
 * conta inteira: o dia é pulado e contado em `failures` para retry.
 */
async function windowWithFallback(igUserId: string, token: string, sinceS: number, untilS: number): Promise<WindowViews> {
  try {
    return await fetchAccountWindow(igUserId, token, sinceS, untilS);
  } catch (err) {
    if (err instanceof MetaRateLimitError) throw err;
    return { ...(await fetchAccountWindow(igUserId, token, sinceS, untilS, "views")), reach: null };
  }
}

/** Views diárias de uma lista de dias (daysAgo). Dias ainda sem dado são omitidos. */
export async function fetchDailyViews(
  igUserId: string,
  token: string,
  daysAgoList: number[],
  nowMs = Date.now()
): Promise<DailyViewsResult> {
  const result: DailyViewsResult = { rows: [], failures: 0, lastError: null };
  for (const daysAgo of daysAgoList) {
    const since = utcDayStart(daysAgo, nowMs);
    try {
      const w = await windowWithFallback(igUserId, token, since, since + DAY_S);
      if (w.views === null) continue; // Meta ainda não consolidou esse dia
      result.rows.push({ day: utcDayIso(since), views: w.views, reach: w.reach });
    } catch (err) {
      if (err instanceof MetaRateLimitError) throw err;
      result.failures++;
      result.lastError = err instanceof Error ? err.message : String(err);
    }
  }
  return result;
}

/**
 * Backfill do histórico: varre blocos de 30 dias (excluindo os
 * `skipRecentDays` mais novos) e só detalha dia a dia os blocos com views > 0 —
 * conta nova custa ~3 chamadas em vez de ~90.
 */
export async function backfillDailyViews(
  igUserId: string,
  token: string,
  totalDays = 90,
  skipRecentDays = 3,
  nowMs = Date.now()
): Promise<DailyViewsResult> {
  const result: DailyViewsResult = { rows: [], failures: 0, lastError: null };
  const CHUNK = 30;
  for (let end = skipRecentDays; end < totalDays; end += CHUNK) {
    const start = Math.min(end + CHUNK, totalDays); // daysAgo mais antigo do bloco
    let chunkViews: number | null;
    try {
      chunkViews = (await fetchAccountWindow(igUserId, token, utcDayStart(start - 1, nowMs), utcDayStart(end - 1, nowMs), "views")).views;
    } catch (err) {
      if (err instanceof MetaRateLimitError) throw err;
      // Não dá para saber se o bloco tem views: detalha dia a dia mesmo assim.
      chunkViews = -1;
      result.lastError = err instanceof Error ? err.message : String(err);
    }
    if (!chunkViews) continue;
    const days: number[] = [];
    for (let d = start - 1; d >= end; d--) days.push(d);
    const daily = await fetchDailyViews(igUserId, token, days, nowMs);
    result.rows.push(...daily.rows);
    result.failures += daily.failures;
    result.lastError = daily.lastError ?? result.lastError;
  }
  return result;
}
