/**
 * Raio-X da fila — resumo do topo e frescor das views (item 10).
 */

import type { AccountInfo, Freshness, Summary } from "./types";
import { HOT_WINDOW_HOURS, HOUR_MS, SUMMARY_DAYS } from "./constants";
import { isAccountUsable } from "./accounts";
import { toPostCard, type CardContext } from "./hot";
import type { ScoredPost } from "./normals";
import { mean, median, roundOrNull } from "./stats";
import { toMs } from "./time";

/**
 * Posts da fila desde `since` (o começo dela, ou 30 dias numa fila antiga).
 * totalViews soma tudo (inclui contas fora do ar, valor congelado); média e
 * mediana só dos maduros; melhor post = mais views.
 */
export function computeSummary(posts: readonly ScoredPost[], cards: CardContext, since: string): Summary {
  const matureViews = posts.filter((sp) => sp.mature).map((sp) => sp.post.views as number);
  let totalViews = 0;
  let best: ScoredPost | null = null;
  for (const sp of posts) {
    if (sp.post.views == null) continue;
    totalViews += sp.post.views;
    if (!best || sp.post.views > (best.post.views as number)) best = sp;
  }
  return {
    windowDays: SUMMARY_DAYS,
    since,
    posts: posts.length,
    totalViews,
    viewsPerPost: roundOrNull(mean(matureViews)),
    medianViews: roundOrNull(median(matureViews)),
    bestPost: best ? toPostCard(best, cards) : null,
  };
}

/** Posts da fila das últimas 48h ainda sem leitura de 4h. */
export function countAwaitingMatureRead(posts: readonly ScoredPost[], nowMs: number): number {
  const fromMs = nowMs - HOT_WINDOW_HOURS * HOUR_MS;
  return posts.filter((sp) => sp.ms >= fromMs && !sp.mature).length;
}

export function computeFreshness(
  posts: readonly ScoredPost[],
  accountById: ReadonlyMap<string, AccountInfo>,
  nowMs: number,
): Freshness {
  let latestMs = -Infinity;
  let latest: string | null = null;
  let frozen = 0;
  for (const sp of posts) {
    const readAt = sp.post.viewsReadAt;
    if (readAt && toMs(readAt) > latestMs) {
      latestMs = toMs(readAt);
      latest = readAt;
    }
    const account = accountById.get(sp.post.accountId);
    if (account && !isAccountUsable(account)) frozen++;
  }
  return {
    viewsReadUntil: latest,
    awaitingMatureRead: countAwaitingMatureRead(posts, nowMs),
    frozenAccountPosts: frozen,
  };
}
