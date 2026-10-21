/**
 * Raio-X da fila — maturidade dos posts e normal da conta (itens 1 e 2).
 *
 * O normal é sempre da CONTA no Instagram (igAccountKey): conta reconectada
 * continua com o mesmo histórico. Calculado com accountPosts (todas as origens),
 * nunca com a mediana da fila.
 */

import type { PostRow } from "./types";
import { ANALYSIS_DAYS, DAY_MS, HOUR_MS, MATURE_HOURS, NORMAL_MIN_POSTS, NORMAL_MIN_VIEWS } from "./constants";
import { median } from "./stats";
import { brtDay, shiftDay, toMs } from "./time";

/**
 * Post maduro: tem views, já tem 4h de publicado E a última leitura que deu
 * certo foi feita 4h+ depois da publicação. Leitura que falhou não atualiza
 * viewsReadAt — então um post lido só aos 2h continua imaturo.
 */
export function isMature(post: PostRow, nowMs: number): boolean {
  if (post.views == null || !post.viewsReadAt) return false;
  const publishedMs = toMs(post.publishedAt);
  const matureMs = MATURE_HOURS * HOUR_MS;
  return nowMs - publishedMs >= matureMs && toMs(post.viewsReadAt) - publishedMs >= matureMs;
}

/** Remove duplicatas (mesmo post vindo de duas listas). */
export function dedupePosts(posts: readonly PostRow[]): PostRow[] {
  const seen = new Set<string>();
  const out: PostRow[] = [];
  for (const p of posts) {
    const key = `${p.source}:${p.postId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(p);
  }
  return out;
}

export interface CurrentNormal {
  value: number | null;
  windowDays: 3 | 7 | 14 | null;
}

export interface Normals {
  /** Normal local do dia BRT `day` (d±1 → d±3 → 14 dias, ≥ 20 posts maduros); null sem amostra. */
  localOnDay(igAccountKey: string, day: string): number | null;
  /** Normal local do dia em que o post foi publicado. */
  localFor(post: Pick<PostRow, "igAccountKey" | "publishedAt">): number | null;
  /** Normal atual (3 → 7 → 14 dias, ≥ 20 posts maduros). */
  current(igAccountKey: string): CurrentNormal;
}

interface MatureSample {
  ms: number;
  views: number;
}

interface AccountSamples {
  byDay: Map<string, number[]>;
  all: MatureSample[];
}

const CURRENT_WINDOWS: readonly (3 | 7 | 14)[] = [3, 7, ANALYSIS_DAYS];

/** Indexa os posts maduros por conta e dia, com cache do normal local por (conta, dia). */
export function buildNormals(accountPosts: readonly PostRow[], now: Date): Normals {
  const nowMs = now.getTime();
  const windowStartMs = nowMs - ANALYSIS_DAYS * DAY_MS;
  const accounts = indexMatureSamples(accountPosts, nowMs);
  const localCache = new Map<string, number | null>();
  const currentCache = new Map<string, CurrentNormal>();

  function localOnDay(igAccountKey: string, day: string): number | null {
    const cacheKey = `${igAccountKey}|${day}`;
    if (localCache.has(cacheKey)) return localCache.get(cacheKey) ?? null;
    const samples = accounts.get(igAccountKey);
    const value = samples ? computeLocalNormal(samples, day, windowStartMs) : null;
    localCache.set(cacheKey, value);
    return value;
  }

  function current(igAccountKey: string): CurrentNormal {
    const cached = currentCache.get(igAccountKey);
    if (cached) return cached;
    const samples = accounts.get(igAccountKey);
    const value = samples ? computeCurrentNormal(samples.all, nowMs) : { value: null, windowDays: null };
    currentCache.set(igAccountKey, value);
    return value;
  }

  return {
    localOnDay,
    localFor: (post) => localOnDay(post.igAccountKey, brtDay(post.publishedAt)),
    current,
  };
}

function indexMatureSamples(posts: readonly PostRow[], nowMs: number): Map<string, AccountSamples> {
  const accounts = new Map<string, AccountSamples>();
  for (const post of dedupePosts(posts)) {
    if (!isMature(post, nowMs)) continue;
    let samples = accounts.get(post.igAccountKey);
    if (!samples) {
      samples = { byDay: new Map(), all: [] };
      accounts.set(post.igAccountKey, samples);
    }
    const views = post.views as number;
    const day = brtDay(post.publishedAt);
    const list = samples.byDay.get(day);
    if (list) list.push(views);
    else samples.byDay.set(day, [views]);
    samples.all.push({ ms: toMs(post.publishedAt), views });
  }
  return accounts;
}

/** d−1..d+1; com menos de 20, d−3..d+3; com menos de 20, a janela de 14 dias; senão null. */
function computeLocalNormal(samples: AccountSamples, day: string, windowStartMs: number): number | null {
  for (const radius of [1, 3]) {
    const views: number[] = [];
    for (let delta = -radius; delta <= radius; delta++) {
      const list = samples.byDay.get(shiftDay(day, delta));
      if (list) views.push(...list);
    }
    if (views.length >= NORMAL_MIN_POSTS) return median(views);
  }
  const windowViews = samples.all.filter((s) => s.ms >= windowStartMs).map((s) => s.views);
  return windowViews.length >= NORMAL_MIN_POSTS ? median(windowViews) : null;
}

/** Últimos 3 dias; com menos de 20, 7; com menos de 20, 14 ("dado antigo"); senão "sem dados". */
function computeCurrentNormal(all: readonly MatureSample[], nowMs: number): CurrentNormal {
  for (const days of CURRENT_WINDOWS) {
    const fromMs = nowMs - days * DAY_MS;
    const views = all.filter((s) => s.ms >= fromMs).map((s) => s.views);
    if (views.length >= NORMAL_MIN_POSTS) return { value: median(views), windowDays: days };
  }
  return { value: null, windowDays: null };
}

/** views ÷ normal, só quando o normal existe e é ≥ `minNormal` (votos: 30; destaque: qualquer > 0). */
export function multipleOf(views: number | null, normal: number | null, minNormal = NORMAL_MIN_VIEWS): number | null {
  if (views == null || normal == null || normal <= 0 || normal < minNormal) return null;
  return views / normal;
}

/** Post da fila já com maturidade, normal local e múltiplo calculados uma vez. */
export interface ScoredPost {
  post: PostRow;
  ms: number;
  mature: boolean;
  /** Normal local do dia do post (qualquer valor). */
  localNormal: number | null;
  /** views ÷ normal local, só para post maduro com normal local ≥ 30 (o que vota). */
  multiple: number | null;
}

export function scorePosts(posts: readonly PostRow[], normals: Normals, nowMs: number): ScoredPost[] {
  return dedupePosts(posts).map((post) => {
    const mature = isMature(post, nowMs);
    const localNormal = normals.localFor(post);
    return {
      post,
      ms: toMs(post.publishedAt),
      mature,
      localNormal,
      multiple: mature ? multipleOf(post.views, localNormal) : null,
    };
  });
}
