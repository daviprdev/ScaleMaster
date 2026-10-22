/**
 * Raio-X da fila — cálculo puro (sem banco), usado pela rota
 * app/api/queue-insights/[source]/[id]. Regras (v2) em docs/fila-ideal.md.
 *
 * Três blocos, como no Hotler: números do topo, o post indo muito bem agora
 * e a fila ideal (melhores vídeos × melhores contas). Tudo sai dos posts
 * contados da fila: views lidas e publicados há 1h ou mais.
 */

import { shortCodeFromUrl } from "../clone-media";
import type {
  AccountInfo,
  AnalyzeInput,
  HotPost,
  IdealAccount,
  IdealQueue,
  IdealVideo,
  PostRow,
  QueueConfig,
  QueueInsightsResponse,
  Summary,
  VideoInfo,
} from "./types";
import {
  BEST_HOUR_MIN_POSTS,
  COUNTED_MIN_AGE_HOURS,
  DAY_MS,
  EXPECTED_MIN_POSTS,
  FALLBACK_INTERVAL_MINUTES,
  FAST_PACE_POSTS_PER_DAY,
  HOT_WINDOW_HOURS,
  HOUR_MS,
  MAX_IDEAL_VIDEOS,
  MAX_POSTS_PER_DAY,
  MIN_ACCOUNT_POSTS,
  MIN_CHOSEN,
  MIN_VIDEO_ACCOUNTS,
  MINUTE_MS,
  MINUTES_PER_DAY,
  PATTERN_DAY_MIN_POSTS,
  REPUBLISH_RECENT_HOURS,
  START_DELAY_MINUTES,
  START_ROUND_MINUTES,
  SUMMARY_DAYS,
} from "./constants";
import { clampInt, groupBy, mean, median, roundOrNull } from "./stats";
import { brtDay, brtHour, ceilToMinutes, nextBrtHourAtOrAfter, toMs } from "./time";
import {
  HOT_TITLE,
  IDEAL_FEW_ACCOUNTS_TEXT,
  IDEAL_FOOTNOTE,
  IDEAL_NO_ACCOUNTS_TEXT,
  IDEAL_NO_VIDEOS_TEXT,
  IDEAL_OUT_OF_FOLDER_TEXT,
  IDEAL_TITLE,
  dayMonthOf,
  hotBody,
  hotEyebrow,
  idealBody,
  idealEyebrow,
} from "./texts";

// ---------------------------------------------------------------------------
// Posts e chave do vídeo
// ---------------------------------------------------------------------------

/** video_id → videoKey (mesmo Reel importado duas vezes = um vídeo só). */
export type VideoKeyResolver = (videoId: string) => string;

/** Post contado, já com o instante e a chave do vídeo resolvidos. */
export interface CountedPost {
  post: PostRow;
  ms: number;
  views: number;
  videoKey: string | null;
}

/** Post contado = views lidas (não nulas) e publicado há 1h ou mais. */
export function isCounted(post: PostRow, nowMs: number): boolean {
  return post.views != null && toMs(post.publishedAt) <= nowMs - COUNTED_MIN_AGE_HOURS * HOUR_MS;
}

/** Ativa e sem erro: só essas entram na fila ideal e no "Publicar nas outras contas". */
export function isAccountUsable(account: Pick<AccountInfo, "isActive" | "healthStatus">): boolean {
  return account.isActive && account.healthStatus !== "error";
}

/**
 * Primeiro a chave que o load gravou nos posts, depois o source_url da
 * Biblioteca (shortcode do Reel), por fim o próprio id.
 */
export function buildVideoKeyResolver(posts: readonly PostRow[], videos: readonly VideoInfo[]): VideoKeyResolver {
  const fromPosts = new Map<string, string>();
  for (const p of posts) if (p.videoId && p.videoKey) fromPosts.set(p.videoId, p.videoKey);
  const fromLibrary = new Map(videos.map((v) => [v.id, (v.sourceUrl ? shortCodeFromUrl(v.sourceUrl) : null) ?? v.id]));
  return (id) => fromPosts.get(id) ?? fromLibrary.get(id) ?? id;
}

/** Chave do vídeo do post; null quando o post não tem vídeo (apagado). */
export function postVideoKey(post: PostRow, keyOf: VideoKeyResolver): string | null {
  if (post.videoKey) return post.videoKey;
  return post.videoId ? keyOf(post.videoId) : null;
}

/** Posts da fila sem duplicata, dentro dos 30 dias. */
function queueWindowPosts(posts: readonly PostRow[], nowMs: number): PostRow[] {
  const fromMs = nowMs - SUMMARY_DAYS * DAY_MS;
  const seen = new Set<string>();
  const out: PostRow[] = [];
  for (const p of posts) {
    const id = `${p.source}:${p.postId}`;
    if (seen.has(id) || !(toMs(p.publishedAt) >= fromMs)) continue;
    seen.add(id);
    out.push(p);
  }
  return out;
}

export function countedPosts(posts: readonly PostRow[], nowMs: number, keyOf: VideoKeyResolver): CountedPost[] {
  return posts
    .filter((p) => isCounted(p, nowMs))
    .map((p) => ({ post: p, ms: toMs(p.publishedAt), views: p.views as number, videoKey: postVideoKey(p, keyOf) }));
}

// ---------------------------------------------------------------------------
// 1. Números do topo
// ---------------------------------------------------------------------------

/**
 * Publicações = todos os reels da fila. Visualizações, média (A) e melhor post
 * só com os contados: post com menos de 1h entra só no total de publicações
 * (o número dele ainda está subindo).
 */
export function computeSummary(
  queue: Pick<QueueConfig, "createdAt">,
  posts: readonly PostRow[],
  counted: readonly CountedPost[],
  nowMs: number,
): Summary {
  const createdMs = toMs(queue.createdAt);
  const since = Math.max(Number.isFinite(createdMs) ? createdMs : 0, nowMs - SUMMARY_DAYS * DAY_MS);
  const views = counted.map((c) => c.views);
  return {
    since: new Date(since).toISOString(),
    posts: posts.length,
    totalViews: views.reduce((sum, v) => sum + v, 0),
    viewsPerPost: roundOrNull(mean(views)),
    // reduce, não Math.max(...views): o spread estoura a pilha acima de ~125 mil posts.
    bestPostViews: views.length > 0 ? views.reduce((max, v) => (v > max ? v : max), -Infinity) : null,
  };
}

// ---------------------------------------------------------------------------
// Vídeos já usados por conta (para "Publicar nas outras contas")
// ---------------------------------------------------------------------------

/**
 * igAccountKey → videoKeys que a conta publicou nesta fila nas últimas 24h.
 * Não usa o histórico completo nem os agendados: numa campanha que roda a pasta
 * inteira toda conta já tem todo vídeo agendado, e o "Publicar nas outras
 * contas" nunca teria conta para oferecer.
 */
export function recentKeysByIg(
  posts: readonly PostRow[],
  sinceMs: number,
  keyOf: VideoKeyResolver,
): Map<string, Set<string>> {
  const byIg = new Map<string, Set<string>>();
  for (const post of posts) {
    if (toMs(post.publishedAt) < sinceMs) continue;
    const key = postVideoKey(post, keyOf);
    if (!key) continue;
    const set = byIg.get(post.igAccountKey);
    if (set) set.add(key);
    else byIg.set(post.igAccountKey, new Set([key]));
  }
  return byIg;
}

/** Contas da fila em ordem, sem repetir conta do Instagram, só as que existem. */
function queueAccounts(queue: Pick<QueueConfig, "accountIds">, accountById: ReadonlyMap<string, AccountInfo>): AccountInfo[] {
  const seenIg = new Set<string>();
  const out: AccountInfo[] = [];
  for (const id of queue.accountIds) {
    const account = accountById.get(id);
    if (!account || seenIg.has(account.igAccountKey)) continue;
    seenIg.add(account.igAccountKey);
    out.push(account);
  }
  return out;
}

// ---------------------------------------------------------------------------
// 2. Post indo muito bem agora
// ---------------------------------------------------------------------------

function byViewsDesc(a: CountedPost, b: CountedPost): number {
  return b.views - a.views || b.ms - a.ms || a.post.postId.localeCompare(b.post.postId);
}

/**
 * O contado de mais views das últimas 48h; sem nenhum, o de mais views da fila.
 * Post com 0 views nunca é candidato ("indo muito bem" precisa de views > 0).
 */
export function pickHotPost(counted: readonly CountedPost[], nowMs: number): CountedPost | null {
  const fromMs = nowMs - HOT_WINDOW_HOURS * HOUR_MS;
  const withViews = counted.filter((c) => c.views > 0);
  const recent = withViews.filter((c) => c.ms >= fromMs);
  const pool = recent.length > 0 ? recent : withViews;
  return [...pool].sort(byViewsDesc)[0] ?? null;
}

/** Mediana das views do vídeo nos posts contados da fila ("publicação típica dele"), sem arredondar. */
export function videoTypicalViews(counted: readonly CountedPost[], videoKey: string | null): number | null {
  if (!videoKey) return null;
  return median(counted.filter((c) => c.videoKey === videoKey).map((c) => c.views));
}

/** Contas da fila ativas e sem erro que não publicaram o vídeo (nem outra cópia dele) nas últimas 24h. */
export function republishAccountIds(args: {
  queue: Pick<QueueConfig, "accountIds">;
  accountById: ReadonlyMap<string, AccountInfo>;
  usedByIg: ReadonlyMap<string, ReadonlySet<string>>;
  videoKey: string | null;
  posterIg: string;
}): string[] {
  const { videoKey } = args;
  if (!videoKey) return [];
  return queueAccounts(args.queue, args.accountById)
    .filter((a) => isAccountUsable(a) && a.igAccountKey !== args.posterIg && !args.usedByIg.get(a.igAccountKey)?.has(videoKey))
    .map((a) => a.id);
}

/** Vídeo que o Postar recebe: o do post, ou outra cópia do mesmo Reel se o do post sumiu da Biblioteca. */
function libraryVideoFor(
  post: PostRow,
  videoKey: string | null,
  videos: readonly VideoInfo[],
  folderIds: ReadonlySet<string>,
  keyOf: VideoKeyResolver,
): VideoInfo | null {
  const own = post.videoId ? videos.find((v) => v.id === post.videoId) : undefined;
  if (own) return own;
  if (!videoKey) return null;
  const copies = videos.filter((v) => keyOf(v.id) === videoKey);
  return copies.find((v) => folderIds.has(v.id)) ?? copies[0] ?? null;
}

function buildHotPost(args: {
  input: AnalyzeInput;
  posts: readonly PostRow[];
  counted: readonly CountedPost[];
  queueAverage: number | null;
  accountById: ReadonlyMap<string, AccountInfo>;
  keyOf: VideoKeyResolver;
  nowMs: number;
}): HotPost | null {
  const hot = pickHotPost(args.counted, args.nowMs);
  if (!hot) return null;
  const { post } = hot;
  const { input } = args;

  const account = args.accountById.get(post.accountId) ?? input.accounts.find((a) => a.igAccountKey === post.igAccountKey);
  const username = account?.username ?? "conta";
  const video = libraryVideoFor(post, hot.videoKey, input.videos, new Set(input.queue.folderVideoIds), args.keyOf);
  const typical = videoTypicalViews(args.counted, hot.videoKey);

  return {
    postId: post.postId,
    source: post.source,
    accountId: post.accountId,
    username,
    avatarUrl: account?.avatarUrl ?? null,
    // null quando o vídeo (e toda cópia dele) saiu da Biblioteca: o Postar não teria o que publicar.
    videoId: video?.id ?? null,
    publicUrl: video?.publicUrl ?? null,
    mediaId: post.mediaId,
    views: hot.views,
    publishedAt: post.publishedAt,
    videoTypicalViews: roundOrNull(typical),
    republishAccountIds: republishAccountIds({
      queue: input.queue,
      accountById: args.accountById,
      usedByIg: recentKeysByIg(args.posts, args.nowMs - REPUBLISH_RECENT_HOURS * HOUR_MS, args.keyOf),
      videoKey: hot.videoKey,
      posterIg: post.igAccountKey,
    }),
    eyebrow: hotEyebrow(hot.views, post.publishedAt),
    title: HOT_TITLE,
    body: hotBody({ username, views: hot.views, typicalViews: typical, queueAverage: args.queueAverage }),
  };
}

// ---------------------------------------------------------------------------
// 3. Fila ideal — vídeos
// ---------------------------------------------------------------------------

/** IdealVideo com a chave do Reel, que o cálculo usa e o contrato não leva. `avgViews` sem arredondar. */
export interface RankedVideo extends IdealVideo {
  videoKey: string;
}

export interface VideoRanking {
  /** Elegíveis (3+ contas e na pasta), da maior média para a menor. */
  eligible: RankedVideo[];
  /** Vídeos com 3+ contas que saíram da pasta (só para explicar a fila vazia). */
  outOfFolder: number;
}

/**
 * Vídeo elegível: posts contados em 3+ contas do Instagram e algum video_id
 * dessa chave ainda na pasta da fila — é esse id que vai para o Postar.
 */
export function rankVideos(args: {
  counted: readonly CountedPost[];
  folderVideoIds: readonly string[];
  videos: readonly VideoInfo[];
  keyOf: VideoKeyResolver;
}): VideoRanking {
  const videoById = new Map(args.videos.map((v) => [v.id, v]));
  const folderIdsByKey = groupBy([...new Set(args.folderVideoIds)], (id) => args.keyOf(id));

  const eligible: RankedVideo[] = [];
  let outOfFolder = 0;
  for (const [videoKey, group] of groupBy(args.counted, (c) => c.videoKey)) {
    const accounts = new Set(group.map((c) => c.post.igAccountKey)).size;
    if (accounts < MIN_VIDEO_ACCOUNTS) continue;
    const folderIds = folderIdsByKey.get(videoKey) ?? [];
    if (folderIds.length === 0) {
      outOfFolder++;
      continue;
    }
    const videoId = pickFolderId(folderIds, group);
    const video = videoById.get(videoId);
    eligible.push({
      videoKey,
      videoId,
      publicUrl: video?.publicUrl ?? null,
      caption: video?.caption ?? null,
      avgViews: mean(group.map((c) => c.views)) as number,
      posts: group.length,
      accounts,
    });
  }
  eligible.sort(
    (a, b) => b.avgViews - a.avgViews || b.posts - a.posts || b.accounts - a.accounts || a.videoKey.localeCompare(b.videoKey),
  );
  return { eligible, outOfFolder };
}

/** Com mais de uma cópia na pasta, a de post mais recente na fila; senão a primeira da pasta. */
function pickFolderId(folderIds: readonly string[], group: readonly CountedPost[]): string {
  let best: string | null = null;
  let bestMs = -Infinity;
  for (const c of group) {
    const id = c.post.videoId;
    if (id && folderIds.includes(id) && c.ms > bestMs) {
      best = id;
      bestMs = c.ms;
    }
  }
  return best ?? folderIds[0];
}

/** Elegíveis com média ≥ A, no máximo 10; se menos de 3 passarem, os 3 melhores elegíveis. */
export function chooseVideos<T extends Pick<IdealVideo, "avgViews">>(eligible: readonly T[], average: number): T[] {
  const passing = eligible.filter((v) => v.avgViews >= average);
  return passing.length >= MIN_CHOSEN ? passing.slice(0, MAX_IDEAL_VIDEOS) : eligible.slice(0, MIN_CHOSEN);
}

// ---------------------------------------------------------------------------
// 3. Fila ideal — contas
// ---------------------------------------------------------------------------

/** IdealAccount com a conta do Instagram. `avgViews` sem arredondar. */
export interface RankedAccount extends IdealAccount {
  igAccountKey: string;
}

/**
 * Contas da fila ativas e sem erro com 3+ posts contados e média ≥ A, da maior
 * para a menor. Se menos de 3, as 3 melhores (primeiro as com 3+ posts).
 */
export function chooseAccounts(args: {
  counted: readonly CountedPost[];
  queue: Pick<QueueConfig, "accountIds">;
  accountById: ReadonlyMap<string, AccountInfo>;
  average: number;
}): RankedAccount[] {
  const byIg = groupBy(args.counted, (c) => c.post.igAccountKey);
  const candidates: RankedAccount[] = [];
  for (const account of queueAccounts(args.queue, args.accountById)) {
    if (!isAccountUsable(account)) continue;
    const list = byIg.get(account.igAccountKey) ?? [];
    if (list.length === 0) continue;
    candidates.push({
      accountId: account.id,
      igAccountKey: account.igAccountKey,
      username: account.username,
      avatarUrl: account.avatarUrl,
      avgViews: mean(list.map((c) => c.views)) as number,
      posts: list.length,
    });
  }
  const enough = (a: RankedAccount) => a.posts >= MIN_ACCOUNT_POSTS;
  candidates.sort(
    (a, b) =>
      Number(enough(b)) - Number(enough(a)) ||
      b.avgViews - a.avgViews ||
      b.posts - a.posts ||
      a.username.localeCompare(b.username),
  );
  const passing = candidates.filter((a) => enough(a) && a.avgViews >= args.average);
  return passing.length >= MIN_CHOSEN ? passing : candidates.slice(0, MIN_CHOSEN);
}

// ---------------------------------------------------------------------------
// 3. Fila ideal — ritmo, horário e dia
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

/**
 * Intervalo por conta que a fila ideal herda (minutos, antes do teto de 48/dia).
 * Postar normal: floor(1440 / posts_per_day). Loop: interval_minutes.
 * Modo Ciclo (ou sem intervalo): medido nos posts; sem posts para medir, 60 min.
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

/**
 * Ritmo da fila ideal (posts por dia por conta, teto 48). Postar normal: o
 * posts_per_day da própria campanha — ida e volta por intervalo arredondaria
 * 47/dia para 48. Loop e Modo Ciclo: a partir do intervalo herdado.
 */
export function inheritedPostsPerDay(
  queue: Pick<QueueConfig, "source" | "burstMode" | "intervalMinutes" | "postsPerDay">,
  queuePosts: readonly PostRow[],
): number {
  if (queue.source === "postar" && !queue.burstMode && queue.postsPerDay != null && queue.postsPerDay > 0) {
    return clampInt(queue.postsPerDay, 1, MAX_POSTS_PER_DAY);
  }
  return postsPerDayForInterval(inheritedIntervalMinutes(queue, queuePosts));
}

/** Posts por dia por conta: clamp(round(1440 / intervalo), 1, 48). */
export function postsPerDayForInterval(intervalMinutes: number): number {
  if (!(intervalMinutes > 0)) return MAX_POSTS_PER_DAY;
  return clampInt(MINUTES_PER_DAY / intervalMinutes, 1, MAX_POSTS_PER_DAY);
}

/** Intervalo exibido: floor(1440 / postsPerDay) — o mesmo que o distribute usa. */
export function intervalForPostsPerDay(postsPerDay: number): number {
  return Math.floor(MINUTES_PER_DAY / postsPerDay);
}

/** Média das views dos posts vídeo escolhido × conta escolhida (5+); senão a média das médias dos vídeos. */
export function expectedPerPost(
  counted: readonly CountedPost[],
  videos: readonly RankedVideo[],
  accounts: readonly RankedAccount[],
): number {
  const videoKeys = new Set(videos.map((v) => v.videoKey));
  const igKeys = new Set(accounts.map((a) => a.igAccountKey));
  const pairs = counted.filter((c) => c.videoKey != null && videoKeys.has(c.videoKey) && igKeys.has(c.post.igAccountKey));
  const value = pairs.length >= EXPECTED_MIN_POSTS ? mean(pairs.map((c) => c.views)) : mean(videos.map((v) => v.avgViews));
  return Math.round(value ?? 0);
}

/** Hora BRT com a maior média das contas escolhidas, entre as horas com 5+ posts contados. */
export function computeBestHour(
  counted: readonly CountedPost[],
  igKeys: ReadonlySet<string>,
): { hour: number; views: number } | null {
  const ofChosen = counted.filter((c) => igKeys.has(c.post.igAccountKey));
  let best: { hour: number; mean: number; posts: number } | null = null;
  for (const [hourKey, list] of groupBy(ofChosen, (c) => String(brtHour(c.ms)))) {
    if (list.length < BEST_HOUR_MIN_POSTS) continue;
    const hour = Number(hourKey);
    const avg = mean(list.map((c) => c.views)) as number;
    const better =
      !best ||
      avg > best.mean ||
      (avg === best.mean && (list.length > best.posts || (list.length === best.posts && hour < best.hour)));
    if (better) best = { hour, mean: avg, posts: list.length };
  }
  return best ? { hour: best.hour, views: Math.round(best.mean) } : null;
}

/** Próxima HH:00 BRT pelo menos 10 min à frente; sem horário, agora + 10 min (múltiplo de 5 min). */
export function suggestedStartAt(nowMs: number, bestHour: number | null): string {
  const earliest = nowMs + START_DELAY_MINUTES * MINUTE_MS;
  const at = bestHour == null ? ceilToMinutes(earliest, START_ROUND_MINUTES) : nextBrtHourAtOrAfter(bestHour, earliest);
  return new Date(at).toISOString();
}

/**
 * Padrão do dia: o dia BRT com 20+ posts contados e a maior média por post.
 * Só vira texto ("dd/mm") se nele nenhuma conta postou o mesmo vídeo duas vezes.
 */
export function computePatternDay(
  counted: readonly CountedPost[],
  posts: readonly PostRow[],
  keyOf: VideoKeyResolver,
): string | null {
  let best: { day: string; mean: number } | null = null;
  for (const [day, list] of groupBy(counted, (c) => brtDay(c.ms))) {
    if (list.length < PATTERN_DAY_MIN_POSTS) continue;
    const avg = mean(list.map((c) => c.views)) as number;
    if (!best || avg > best.mean || (avg === best.mean && day > best.day)) best = { day, mean: avg };
  }
  if (!best) return null;

  const pairs = new Set<string>();
  for (const post of posts) {
    if (brtDay(post.publishedAt) !== best.day) continue;
    const key = postVideoKey(post, keyOf);
    if (!key) continue;
    const pair = `${post.igAccountKey}|${key}`;
    if (pairs.has(pair)) return null;
    pairs.add(pair);
  }
  return dayMonthOf(best.day);
}

// ---------------------------------------------------------------------------
// 3. Fila ideal — montagem
// ---------------------------------------------------------------------------

function toIdealVideo(v: RankedVideo): IdealVideo {
  return {
    videoId: v.videoId,
    publicUrl: v.publicUrl,
    caption: v.caption,
    avgViews: Math.round(v.avgViews),
    posts: v.posts,
    accounts: v.accounts,
  };
}

function toIdealAccount(a: RankedAccount): IdealAccount {
  return { accountId: a.accountId, username: a.username, avatarUrl: a.avatarUrl, avgViews: Math.round(a.avgViews), posts: a.posts };
}

type IdealResult = { ideal: IdealQueue; unavailable: null } | { ideal: null; unavailable: string };

function buildIdeal(args: {
  input: AnalyzeInput;
  posts: readonly PostRow[];
  counted: readonly CountedPost[];
  average: number | null;
  accountById: ReadonlyMap<string, AccountInfo>;
  keyOf: VideoKeyResolver;
  nowMs: number;
}): IdealResult {
  const { input, counted, average } = args;
  // Com menos de 3 contas nenhum vídeo chega a 3 — não prometer que "aparece assim que tiver".
  const queueAccounts = new Set<string>(counted.map((c) => c.post.igAccountKey));
  for (const id of input.queue.accountIds) queueAccounts.add(args.accountById.get(id)?.igAccountKey ?? id);
  if (queueAccounts.size < MIN_VIDEO_ACCOUNTS) return { ideal: null, unavailable: IDEAL_FEW_ACCOUNTS_TEXT };
  if (average == null) return { ideal: null, unavailable: IDEAL_NO_VIDEOS_TEXT };

  const ranking = rankVideos({ counted, folderVideoIds: input.queue.folderVideoIds, videos: input.videos, keyOf: args.keyOf });
  if (ranking.eligible.length === 0) {
    return { ideal: null, unavailable: ranking.outOfFolder > 0 ? IDEAL_OUT_OF_FOLDER_TEXT : IDEAL_NO_VIDEOS_TEXT };
  }
  const videos = chooseVideos(ranking.eligible, average);
  const accounts = chooseAccounts({ counted, queue: input.queue, accountById: args.accountById, average });
  if (accounts.length === 0) return { ideal: null, unavailable: IDEAL_NO_ACCOUNTS_TEXT };

  const postsPerDay = inheritedPostsPerDay(input.queue, args.posts);
  const intervalMinutes = intervalForPostsPerDay(postsPerDay);
  const expected = expectedPerPost(counted, videos, accounts);
  const medianPerPost = roundOrNull(median(counted.map((c) => c.views)));
  const bestHour = computeBestHour(counted, new Set(accounts.map((a) => a.igAccountKey)));
  const patternDay = computePatternDay(counted, args.posts, args.keyOf);
  const postsPerCycle = videos.length * accounts.length;

  return {
    unavailable: null,
    ideal: {
      videos: videos.map(toIdealVideo),
      accounts: accounts.map(toIdealAccount),
      postsPerCycle,
      intervalMinutes,
      postsPerDay,
      expectedPerPost: expected,
      medianPerPost,
      bestHour: bestHour?.hour ?? null,
      bestHourViews: bestHour?.views ?? null,
      patternDay,
      // Ritmo rápido (12+ posts/dia) passa pelo dia todo: esperar a melhor hora só atrasaria a fila.
      startAt: suggestedStartAt(args.nowMs, postsPerDay >= FAST_PACE_POSTS_PER_DAY ? null : (bestHour?.hour ?? null)),
      eyebrow: idealEyebrow(expected),
      title: IDEAL_TITLE,
      body: idealBody({
        n: videos.length,
        m: accounts.length,
        postsPerCycle,
        intervalMinutes,
        expectedPerPost: expected,
        medianPerPost,
        bestHour: bestHour?.hour ?? null,
        bestHourViews: bestHour?.views ?? null,
        patternDay,
      }),
      footnote: IDEAL_FOOTNOTE,
    },
  };
}

// ---------------------------------------------------------------------------
// Tudo junto
// ---------------------------------------------------------------------------

/** Calcula tudo que o painel mostra para uma fila. `now` é injetado para os testes. */
export function analyzeQueue(input: AnalyzeInput, now: Date): QueueInsightsResponse {
  const nowMs = now.getTime();
  const posts = queueWindowPosts(input.queuePosts, nowMs);
  const keyOf = buildVideoKeyResolver(posts, input.videos);
  const counted = countedPosts(posts, nowMs, keyOf);
  const accountById = new Map(input.accounts.map((a) => [a.id, a]));

  const summary = computeSummary(input.queue, posts, counted, nowMs);
  // A da doc: média sem arredondar, para o corte "≥ A" não depender do arredondamento.
  const average = mean(counted.map((c) => c.views));
  const shared = { input, posts, counted, accountById, keyOf, nowMs };
  const ideal = buildIdeal({ ...shared, average });

  return {
    queue: input.queue,
    generatedAt: now.toISOString(),
    summary,
    hot: buildHotPost({ ...shared, queueAverage: average }),
    ideal: ideal.ideal,
    idealUnavailable: ideal.unavailable,
  };
}
