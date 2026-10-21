/**
 * Raio-X da fila — a fila de hoje na mesma régua da fila ideal e o fator de
 * repost (item 5). Comparar a previsão da fila ideal com a mediana crua da fila
 * misturaria régua com sorte; aqui as duas usam normal_atual × score.
 */

import type { PostRow } from "./types";
import { DAY_MS, REPOST_MIN_PAIRS } from "./constants";
import { dedupePosts, isMature, multipleOf, type Normals, type ScoredPost } from "./normals";
import { groupBy, mean, median } from "./stats";
import { toMs } from "./time";
import { postVideoKey, type VideoKeyResolver } from "./videos";

const BASELINE_DAYS = 7;

export interface QueueBaseline {
  currentTypicalPerPost: number | null;
  currentMeanAccountNormal: number | null;
  currentMeanVideoScore: number | null;
  currentObservedMedian: number | null;
}

/**
 * Média, nos posts maduros da fila dos últimos 7 dias, de
 * normal_atual(conta) × (score(vídeo) ?? 1). Contas sem normal ficam fora.
 * A mediana real usa os posts maduros da janela de análise (14 dias).
 */
export function currentQueueBaseline(args: {
  /** Posts da fila na janela de análise (14 dias), já pontuados. */
  posts: readonly ScoredPost[];
  normals: Normals;
  scoreByKey: ReadonlyMap<string, number | null>;
  keyOf: VideoKeyResolver;
  nowMs: number;
}): QueueBaseline {
  const fromMs = args.nowMs - BASELINE_DAYS * DAY_MS;
  const products: number[] = [];
  const normals: number[] = [];
  const scores: number[] = [];
  for (const sp of args.posts) {
    if (!sp.mature || sp.ms < fromMs) continue;
    const normal = args.normals.current(sp.post.igAccountKey).value;
    if (normal == null) continue;
    const key = postVideoKey(sp.post, args.keyOf);
    const score = (key ? args.scoreByKey.get(key) : null) ?? 1;
    products.push(normal * score);
    normals.push(normal);
    scores.push(score);
  }
  return {
    currentTypicalPerPost: mean(products),
    currentMeanAccountNormal: mean(normals),
    currentMeanVideoScore: mean(scores),
    currentObservedMedian: median(args.posts.filter((sp) => sp.mature).map((sp) => sp.post.views as number)),
  };
}

export interface RepostFactor {
  /** Mediana das razões; 1 até haver 30 pares. */
  factor: number;
  pairs: number;
}

/**
 * Para cada par (vídeo, conta) com 2+ posts maduros com múltiplo (normal local
 * ≥ 30) em accountPosts: mediana dos múltiplos do 2º post em diante ÷ múltiplo
 * do 1º. O fator é a mediana das razões, só com 30+ pares.
 */
export function computeRepostFactor(
  accountPosts: readonly PostRow[],
  normals: Normals,
  keyOf: VideoKeyResolver,
  nowMs: number,
): RepostFactor {
  const withMultiple = dedupePosts(accountPosts)
    .filter((p) => isMature(p, nowMs))
    .map((p) => ({ post: p, ms: toMs(p.publishedAt), multiple: multipleOf(p.views, normals.localFor(p)) }))
    .filter((x) => x.multiple != null);

  const ratios: number[] = [];
  const pairs = groupBy(withMultiple, (x) => {
    const key = postVideoKey(x.post, keyOf);
    return key ? `${x.post.igAccountKey}|${key}` : null;
  });
  for (const list of pairs.values()) {
    if (list.length < 2) continue;
    list.sort((a, b) => a.ms - b.ms);
    const first = list[0].multiple as number;
    if (first <= 0) continue;
    const later = median(list.slice(1).map((x) => x.multiple as number)) as number;
    ratios.push(later / first);
  }
  const factor = ratios.length >= REPOST_MIN_PAIRS ? (median(ratios) as number) : 1;
  return { factor, pairs: ratios.length };
}
