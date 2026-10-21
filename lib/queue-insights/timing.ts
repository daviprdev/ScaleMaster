/**
 * Raio-X da fila — melhor horário (item 6), melhor dia (item 7) e o intervalo
 * medido nos posts (Modo Ciclo, item 5).
 */

import type { BestDay, BestHour, DayPattern, PostRow } from "./types";
import {
  ANALYSIS_DAYS,
  BEST_DAY_MATURE_SHARE,
  BEST_DAY_MEDIAN_SHARE,
  BEST_DAY_MIN_ACCOUNTS,
  BEST_DAY_MIN_POSTS,
  BEST_HOUR_GOOD_MIN_POSTS,
  BEST_HOUR_LIFT,
  BEST_HOUR_MIN_ACCOUNTS,
  BEST_HOUR_MIN_HOURS,
  BEST_HOUR_MIN_POSTS,
  MINUTE_MS,
} from "./constants";
import type { ScoredPost } from "./normals";
import { groupBy, mean, median, percentile } from "./stats";
import { brtDay, brtHour, shiftDay, toMs } from "./time";
import { postVideoKey, type VideoKeyResolver } from "./videos";

// ---------------------------------------------------------------------------
// Intervalo real entre publicações
// ---------------------------------------------------------------------------

/**
 * Mediana, entre contas, da mediana dos intervalos entre publicações
 * consecutivas de cada conta (minutos). null sem conta com 2+ posts.
 */
export function medianAccountGapMinutes(posts: readonly PostRow[]): number | null {
  const perAccount: number[] = [];
  for (const list of groupBy(posts, (p) => p.igAccountKey).values()) {
    if (list.length < 2) continue;
    const times = list.map((p) => toMs(p.publishedAt)).sort((a, b) => a - b);
    const gaps: number[] = [];
    for (let i = 1; i < times.length; i++) gaps.push((times[i] - times[i - 1]) / MINUTE_MS);
    const gap = median(gaps);
    if (gap != null) perAccount.push(gap);
  }
  return median(perAccount);
}

// ---------------------------------------------------------------------------
// Melhor horário
// ---------------------------------------------------------------------------

/** Score por hora qualificada (≥ 10 posts com múltiplo e ≥ 3 contas). */
export function qualifiedHourScores(posts: readonly ScoredPost[]): Record<number, number> {
  const withMultiple = posts.filter((sp) => sp.mature && sp.multiple != null);
  const scores: Record<number, number> = {};
  for (const [hour, list] of groupBy(withMultiple, (sp) => String(brtHour(sp.ms)))) {
    const accounts = new Set(list.map((sp) => sp.post.igAccountKey));
    if (list.length < BEST_HOUR_MIN_POSTS || accounts.size < BEST_HOUR_MIN_ACCOUNTS) continue;
    scores[Number(hour)] = median(list.map((sp) => sp.multiple as number)) as number;
  }
  return scores;
}

/**
 * Melhor horário dos posts maduros da fila (14 dias). Só existe com 3+ horas
 * qualificadas e a melhor ≥ 1,2× a mediana delas; senão o horário não fez diferença.
 */
export function computeBestHour(posts: readonly ScoredPost[], goodAccountIds: ReadonlySet<string>): BestHour | null {
  const hourScores = qualifiedHourScores(posts);
  const hours = Object.keys(hourScores).map(Number).sort((a, b) => a - b);
  if (hours.length < BEST_HOUR_MIN_HOURS) return null;

  let best = hours[0];
  for (const h of hours) if (hourScores[h] > hourScores[best]) best = h;
  const typical = median(hours.map((h) => hourScores[h])) as number;
  if (hourScores[best] < BEST_HOUR_LIFT * typical) return null;

  return {
    hour: best,
    score: hourScores[best],
    typicalViews: typicalViewsAt(best, posts, goodAccountIds),
    hourScores,
  };
}

/** Mediana das views brutas na hora: das contas boas se tiverem 5+ posts nela, senão da fila toda. */
function typicalViewsAt(hour: number, posts: readonly ScoredPost[], goodAccountIds: ReadonlySet<string>): number {
  const inHour = posts.filter((sp) => sp.mature && brtHour(sp.ms) === hour);
  const fromGood = inHour.filter((sp) => goodAccountIds.has(sp.post.accountId));
  const source = fromGood.length >= BEST_HOUR_GOOD_MIN_POSTS ? fromGood : inHour;
  return Math.round(median(source.map((sp) => sp.post.views as number)) ?? 0);
}

// ---------------------------------------------------------------------------
// Padrão de um dia
// ---------------------------------------------------------------------------

export interface DayPatternContext {
  /** Modo Ciclo: intervalo do dia não faz sentido. */
  burstMode: boolean;
  keyOf: VideoKeyResolver;
  /** `${igAccountKey}|${videoKey}` → primeiro dia BRT em que a conta usou o vídeo (qualquer origem). */
  firstUseDay: ReadonlyMap<string, string>;
  /** igAccountKey → dias BRT em que a conta publicou por outra origem que não esta fila. */
  otherOriginDays: ReadonlyMap<string, ReadonlySet<string>>;
}

/** Monta o contexto do padrão a partir de todos os posts conhecidos (accountPosts + fila). */
export function buildDayPatternContext(
  allPosts: readonly PostRow[],
  isThisQueue: (post: PostRow) => boolean,
  burstMode: boolean,
  keyOf: VideoKeyResolver,
): DayPatternContext {
  const firstUseDay = new Map<string, string>();
  const otherOriginDays = new Map<string, Set<string>>();
  for (const post of allPosts) {
    const day = brtDay(post.publishedAt);
    const videoKey = postVideoKey(post, keyOf);
    if (videoKey) {
      const pair = `${post.igAccountKey}|${videoKey}`;
      const first = firstUseDay.get(pair);
      if (!first || day < first) firstUseDay.set(pair, day);
    }
    // Só outras FILAS: post avulso (sem fila) não conta como fila compartilhada.
    if (!isThisQueue(post) && post.queueId != null) {
      const days = otherOriginDays.get(post.igAccountKey) ?? new Set<string>();
      days.add(day);
      otherOriginDays.set(post.igAccountKey, days);
    }
  }
  return { burstMode, keyOf, firstUseDay, otherOriginDays };
}

/** Como a fila rodou num dia: contas, posts, ritmo, faixa horária e repetições. */
export function dayPattern(date: string, posts: readonly PostRow[], ctx: DayPatternContext): DayPattern {
  const accounts = new Set(posts.map((p) => p.igAccountKey));
  const hours = posts.map((p) => brtHour(p.publishedAt));

  let repeatedSameDay = 0;
  let repeatedFromBefore = 0;
  const pairCount = new Map<string, number>();
  for (const post of posts) {
    const videoKey = postVideoKey(post, ctx.keyOf);
    if (!videoKey) continue;
    const pair = `${post.igAccountKey}|${videoKey}`;
    const seen = pairCount.get(pair) ?? 0;
    if (seen > 0) repeatedSameDay++;
    pairCount.set(pair, seen + 1);
    // "Antes" = dias anteriores; a repetição no mesmo dia já conta acima.
    const first = ctx.firstUseDay.get(pair);
    if (first && first < date) repeatedFromBefore++;
  }

  let alsoInOther = 0;
  for (const account of accounts) if (ctx.otherOriginDays.get(account)?.has(date)) alsoInOther++;

  const interval = ctx.burstMode ? null : medianAccountGapMinutes(posts);
  return {
    date,
    accounts: accounts.size,
    posts: posts.length,
    medianIntervalMinutes: interval == null ? null : Math.round(interval),
    hourFrom: percentile(hours, 0.1),
    hourTo: percentile(hours, 0.9),
    repeatedSameDay,
    repeatedFromBefore,
    accountsAlsoInOtherQueues: alsoInOther,
  };
}

// ---------------------------------------------------------------------------
// Melhor dia
// ---------------------------------------------------------------------------

/** Dias BRT completos da janela de análise, anteriores a hoje (ontem … hoje − 13). */
export function completeWindowDays(nowMs: number): string[] {
  const today = brtDay(nowMs);
  const days: string[] = [];
  for (let i = 1; i < ANALYSIS_DAYS; i++) days.push(shiftDay(today, -i));
  return days;
}

/** ≥ 90% maduros, ≥ max(20, 50% da mediana diária) posts e ≥ 3 contas. */
export function isBestDayCandidate(posts: readonly ScoredPost[], minPosts: number): boolean {
  if (posts.length === 0 || posts.length < minPosts) return false;
  const mature = posts.filter((sp) => sp.mature).length;
  if (mature / posts.length < BEST_DAY_MATURE_SHARE) return false;
  return new Set(posts.map((sp) => sp.post.igAccountKey)).size >= BEST_DAY_MIN_ACCOUNTS;
}

/** Mínimo de posts de um dia candidato: max(20, 50% da mediana diária da fila). */
export function bestDayMinPosts(dailyCounts: readonly number[]): number {
  return Math.max(BEST_DAY_MIN_POSTS, BEST_DAY_MEDIAN_SHARE * (median(dailyCounts) ?? 0));
}

/** O dia com a maior mediana de múltiplo, com o padrão dele e o de hoje. */
export function computeBestDay(posts: readonly ScoredPost[], nowMs: number, ctx: DayPatternContext): BestDay | null {
  const windowDays = new Set(completeWindowDays(nowMs));
  const byDay = groupBy(
    posts.filter((sp) => windowDays.has(brtDay(sp.ms))),
    (sp) => brtDay(sp.ms),
  );
  const minPosts = bestDayMinPosts([...byDay.values()].map((list) => list.length));

  let best: { day: string; list: ScoredPost[]; medianMultiple: number } | null = null;
  for (const [day, list] of byDay) {
    if (!isBestDayCandidate(list, minPosts)) continue;
    const medianMultiple = median(list.filter((sp) => sp.mature && sp.multiple != null).map((sp) => sp.multiple as number));
    if (medianMultiple == null) continue;
    if (!best || medianMultiple > best.medianMultiple || (medianMultiple === best.medianMultiple && day > best.day)) {
      best = { day, list, medianMultiple };
    }
  }
  if (!best) return null;

  const matureViews = best.list.filter((sp) => sp.mature).map((sp) => sp.post.views as number);
  return {
    ...dayPattern(best.day, best.list.map((sp) => sp.post), ctx),
    medianMultiple: best.medianMultiple,
    meanViews: Math.round(mean(matureViews) ?? 0),
    medianViews: Math.round(median(matureViews) ?? 0),
    today: todayPattern(posts, nowMs, ctx),
  };
}

/** O padrão de hoje até agora (sem views). null quando a fila ainda não postou hoje. */
export function todayPattern(posts: readonly ScoredPost[], nowMs: number, ctx: DayPatternContext): DayPattern | null {
  const today = brtDay(nowMs);
  const list = posts.filter((sp) => sp.ms <= nowMs && brtDay(sp.ms) === today).map((sp) => sp.post);
  return list.length > 0 ? dayPattern(today, list, ctx) : null;
}
