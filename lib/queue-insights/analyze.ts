/**
 * Raio-X da fila — cálculo puro (sem banco), usado pela rota
 * app/api/queue-insights/[source]/[id]. Regras em docs/fila-ideal.md.
 *
 * Cada parte mora num módulo pequeno (normals, videos, accounts, hot, timing,
 * readiness, baseline, summary); aqui só se costura: posts pontuados uma vez,
 * depois cada seção lê o que precisa. `accountLoad24h` fica com a rota.
 */

import type {
  AccountScore,
  AnalyzeInput,
  BestHour,
  IdealInputs,
  PostRow,
  QueueConfig,
  QueueInsightsResponse,
  SnapshotRow,
  VideoScore,
} from "./types";
import { ANALYSIS_DAYS, DAY_MS, FALLBACK_INTERVAL_MINUTES, MAX_IDEAL_VIDEOS, MINUTES_PER_DAY, SUMMARY_DAYS } from "./constants";
import { rankAccounts } from "./accounts";
import { computeRepostFactor, currentQueueBaseline, type QueueBaseline, type RepostFactor } from "./baseline";
import { buildHotSection, snapshotKey, type CardContext } from "./hot";
import { buildIdealQueue, postsPerDayForInterval } from "./ideal";
import { buildNormals, dedupePosts, scorePosts, type ScoredPost } from "./normals";
import { computeReadiness, resolveVideoCountCap, videoCoverage } from "./readiness";
import { clampInt } from "./stats";
import { computeFreshness, computeSummary } from "./summary";
import { toMs } from "./time";
import { buildDayPatternContext, computeBestDay, computeBestHour, medianAccountGapMinutes } from "./timing";
import { buildUsedVideoKeys, buildVideoKeyResolver, scoreVideos } from "./videos";

/**
 * Intervalo por conta que a fila ideal herda (minutos, antes do clamp de 1–48 posts/dia).
 * Postar normal: floor(1440 / posts_per_day). Loop: interval_minutes.
 * Modo Ciclo: medido nos posts (mediana entre contas da mediana dos intervalos
 * de cada conta), em minutos inteiros; sem posts para medir, 60 min.
 */
export function inheritedIntervalMinutes(
  queue: Pick<QueueConfig, "source" | "burstMode" | "intervalMinutes" | "postsPerDay">,
  queuePosts: readonly PostRow[],
): number {
  if (queue.burstMode || queue.intervalMinutes == null) {
    const measured = medianAccountGapMinutes(queuePosts);
    return measured == null ? FALLBACK_INTERVAL_MINUTES : Math.round(measured);
  }
  if (queue.source === "postar" && queue.postsPerDay != null && queue.postsPerDay > 0) {
    return Math.floor(MINUTES_PER_DAY / queue.postsPerDay);
  }
  return queue.intervalMinutes;
}

function countByAccount(posts: readonly ScoredPost[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const sp of posts) counts.set(sp.post.accountId, (counts.get(sp.post.accountId) ?? 0) + 1);
  return counts;
}

function groupSnapshots(snapshots: readonly SnapshotRow[]): Map<string, SnapshotRow[]> {
  const byPost = new Map<string, SnapshotRow[]>();
  for (const s of snapshots) {
    const key = snapshotKey(s.source, s.postId);
    const list = byPost.get(key);
    if (list) list.push(s);
    else byPost.set(key, [s]);
  }
  return byPost;
}

/**
 * Só os vídeos que passam, por conta, que a conta já usou (por videoKey: outra
 * cópia do mesmo Reel também é repost). É tudo que buildIdealQueue precisa, e
 * mantém pequeno o que vai para o navegador.
 */
function usedPassingVideoIds(
  accounts: readonly AccountScore[],
  passing: readonly VideoScore[],
  usedKeysByAccount: ReadonlyMap<string, ReadonlySet<string>>,
): Record<string, string[]> {
  const used: Record<string, string[]> = {};
  for (const account of accounts) {
    const keys = usedKeysByAccount.get(account.accountId);
    if (!keys) continue;
    const ids = passing.filter((v) => v.videoId != null && keys.has(v.videoKey)).map((v) => v.videoId as string);
    if (ids.length > 0) used[account.accountId] = ids;
  }
  return used;
}

export function buildIdealInputs(args: {
  queue: QueueConfig;
  videos: readonly VideoScore[];
  accounts: readonly AccountScore[];
  usedKeysByAccount: ReadonlyMap<string, ReadonlySet<string>>;
  intervalMinutes: number;
  repost: RepostFactor;
  baseline: QueueBaseline;
  bestHour: BestHour | null;
  nowIso: string;
}): IdealInputs {
  const passing = args.videos.filter((v) => v.status === "passes" && v.videoId != null);
  const eligible = args.accounts.filter((a) => a.status !== "inactive");
  const maxN = Math.min(Math.max(resolveVideoCountCap(args.queue), 0), MAX_IDEAL_VIDEOS);
  const defaultN = passing.length === 0 ? 0 : clampInt(Math.min(passing.length, maxN), 1, MAX_IDEAL_VIDEOS);

  return {
    videos: passing,
    accounts: eligible,
    defaultN,
    defaultM: eligible.filter((a) => a.status === "good").length,
    maxN,
    intervalMinutes: args.intervalMinutes,
    postsPerDay: postsPerDayForInterval(args.intervalMinutes),
    accountStaggerSeconds: args.queue.handoff.accountStaggerSeconds,
    repostFactor: args.repost.factor,
    repostPairs: args.repost.pairs,
    usedVideoIdsByAccount: usedPassingVideoIds(eligible, passing, args.usedKeysByAccount),
    ...args.baseline,
    bestHour: args.bestHour,
    nowIso: args.nowIso,
  };
}

/** Calcula tudo que o painel mostra para uma fila. `now` é injetado para os testes. */
export function analyzeQueue(input: AnalyzeInput, now: Date): Omit<QueueInsightsResponse, "accountLoad24h"> {
  const nowMs = now.getTime();
  const nowIso = now.toISOString();
  const { queue } = input;

  // Posts: os da fila (30 dias) pontuados uma vez; o normal vem de accountPosts.
  const queuePosts = dedupePosts(input.queuePosts).filter((p) => toMs(p.publishedAt) >= nowMs - SUMMARY_DAYS * DAY_MS);
  const allPosts = dedupePosts([...input.accountPosts, ...queuePosts]);
  const keyOf = buildVideoKeyResolver(allPosts, input.videos);
  const normals = buildNormals(input.accountPosts, now);
  const scored = scorePosts(queuePosts, normals, nowMs);
  const scored14 = scored.filter((sp) => sp.ms >= nowMs - ANALYSIS_DAYS * DAY_MS);

  const accountById = new Map(input.accounts.map((a) => [a.id, a]));
  const cards: CardContext = {
    accountById,
    videoById: new Map(input.videos.map((v) => [v.id, v])),
    snapshotsByPost: groupSnapshots(input.snapshots),
  };
  const usedKeysByAccount = buildUsedVideoKeys(input.usedVideoIdsByAccount, input.accounts, allPosts, keyOf);

  // Vídeos e contas (itens 3 e 4).
  const videos = scoreVideos({ posts: scored14, videos: input.videos, folderVideoIds: queue.folderVideoIds, keyOf });
  const accounts = rankAccounts({
    accountIds: queue.accountIds,
    accounts: input.accounts,
    normals,
    postsInQueue: countByAccount(scored14),
  });
  const goodAccountIds = new Set(accounts.filter((a) => a.status === "good").map((a) => a.accountId));

  // Topo do painel (itens 8 e 10).
  const freshness = computeFreshness(scored, accountById, nowMs);
  const summary = computeSummary(scored, cards);
  const hot = buildHotSection({ queue, posts: scored, nowMs, cards, usedKeysByAccount, keyOf });

  // Prontidão (item 9).
  const readiness = computeReadiness({
    queue,
    coverage: videoCoverage(scored14, keyOf),
    passingVideos: videos.filter((v) => v.status === "passes").length,
    goodAccounts: goodAccountIds.size,
    accountsWithNormal: accounts.filter((a) => a.status === "good" || a.status === "weak").length,
    awaitingMatureRead: freshness.awaitingMatureRead,
    nowMs,
  });

  // Horário e dia (itens 6 e 7).
  const bestHour = computeBestHour(scored14, goodAccountIds);
  const isThisQueue = (p: PostRow) => p.source === queue.source && p.queueId === queue.id;
  const bestDay = computeBestDay(scored, nowMs, buildDayPatternContext(allPosts, isThisQueue, queue.burstMode, keyOf));

  // Fila ideal (item 5): só calculada quando a régua fecha.
  const idealInputs = buildIdealInputs({
    queue,
    videos,
    accounts,
    usedKeysByAccount,
    intervalMinutes: inheritedIntervalMinutes(queue, scored14.map((sp) => sp.post)),
    repost: computeRepostFactor(input.accountPosts, normals, keyOf, nowMs),
    baseline: currentQueueBaseline({
      posts: scored14,
      normals,
      scoreByKey: new Map(videos.map((v) => [v.videoKey, v.score])),
      keyOf,
      nowMs,
    }),
    bestHour,
    nowIso,
  });
  const ideal = readiness.state === "ready" ? buildIdealQueue(idealInputs, idealInputs.defaultN, idealInputs.defaultM) : null;

  return {
    queue,
    generatedAt: nowIso,
    freshness,
    summary,
    hot,
    readiness,
    videos,
    accounts,
    idealInputs,
    ideal,
    bestHour,
    bestDay,
    missingSql: input.missingSql,
  };
}
