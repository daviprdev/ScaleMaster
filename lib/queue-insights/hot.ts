/**
 * Raio-X da fila — cartão de post e "bombando agora" (item 8).
 *
 * Destaque = post das últimas 48h, maduro, ≥ 5× o normal local da conta E
 * entre os 10% com mais views da fila em 30 dias. As duas condições juntas:
 * 5× numa conta pequena não basta, e muitas views numa conta grande também não.
 */

import type { AccountInfo, HotSection, PostCard, PostRow, QueueConfig, SnapshotRow, VideoInfo } from "./types";
import {
  HOT_MAX_HIGHLIGHTS,
  HOT_MIN_MULTIPLE,
  HOT_PERCENTILE,
  HOT_WINDOW_HOURS,
  HOUR_MS,
  RISING_MIN_GAIN,
  RISING_MIN_GAP_HOURS,
} from "./constants";
import { isAccountUsable } from "./accounts";
import { multipleOf, type ScoredPost } from "./normals";
import { percentile } from "./stats";
import { toMs } from "./time";
import {
  HOT_EMPTY_TEXT,
  HOT_NONE_TITLE,
  HOT_TITLE,
  hotFallbackText,
  hotHighlightText,
  risingText,
} from "./texts";
import { postVideoKey, type VideoKeyResolver } from "./videos";

// ---------------------------------------------------------------------------
// Cartão de post
// ---------------------------------------------------------------------------

export interface CardContext {
  accountById: ReadonlyMap<string, AccountInfo>;
  videoById: ReadonlyMap<string, VideoInfo>;
  /** `${source}:${postId}` → leituras guardadas pelo trigger. */
  snapshotsByPost: ReadonlyMap<string, readonly SnapshotRow[]>;
}

export function snapshotKey(source: string, postId: string): string {
  return `${source}:${postId}`;
}

/**
 * Selo "ainda subindo": leitura mais recente vs a leitura anterior a ≥ 3h dela.
 * Ganho ≥ 20% e ≥ normal local → "+X views desde a leitura das HHh".
 * Sem histórico (SQL não aplicado) ou sem normal local: null.
 */
export function risingTextFor(post: PostRow, snapshots: readonly SnapshotRow[], localNormal: number | null): string | null {
  if (localNormal == null || localNormal <= 0) return null;
  const readings = snapshots.map((s) => ({ ms: toMs(s.readAt), views: s.views }));
  if (post.views != null && post.viewsReadAt) readings.push({ ms: toMs(post.viewsReadAt), views: post.views });
  if (readings.length < 2) return null;

  readings.sort((a, b) => a.ms - b.ms || a.views - b.views);
  const latest = readings[readings.length - 1];
  const cutoff = latest.ms - RISING_MIN_GAP_HOURS * HOUR_MS;
  let previous: { ms: number; views: number } | null = null;
  for (const r of readings) if (r.ms <= cutoff) previous = r;
  if (!previous) return null;

  const gain = latest.views - previous.views;
  if (gain <= 0 || gain < localNormal) return null;
  if (previous.views > 0 && gain < RISING_MIN_GAIN * previous.views) return null;
  return risingText(gain, previous.ms);
}

export function toPostCard(sp: ScoredPost, ctx: CardContext): PostCard {
  const { post } = sp;
  const account = ctx.accountById.get(post.accountId);
  const video = post.videoId ? ctx.videoById.get(post.videoId) : undefined;
  return {
    postId: post.postId,
    source: post.source,
    accountId: post.accountId,
    username: account?.username ?? "conta",
    avatarUrl: account?.avatarUrl ?? null,
    videoId: post.videoId,
    publicUrl: video?.publicUrl ?? null,
    mediaId: post.mediaId,
    views: post.views ?? 0,
    multiple: multipleOf(post.views, sp.localNormal, 0),
    publishedAt: post.publishedAt,
    viewsReadAt: post.viewsReadAt,
    risingText: risingTextFor(post, ctx.snapshotsByPost.get(snapshotKey(post.source, post.postId)) ?? [], sp.localNormal),
  };
}

// ---------------------------------------------------------------------------
// Bombando agora
// ---------------------------------------------------------------------------

/** p90 das views maduras da fila (30 dias). */
export function hotViewsThreshold(posts: readonly ScoredPost[]): number | null {
  return percentile(
    posts.filter((sp) => sp.mature).map((sp) => sp.post.views as number),
    HOT_PERCENTILE,
  );
}

/** Fora da curva: múltiplo ≥ 5 E views ≥ p90 da fila. */
export function isHot(multiple: number | null, views: number, p90: number | null): boolean {
  return multiple != null && p90 != null && multiple >= HOT_MIN_MULTIPLE && views >= p90;
}

/** Contas da fila ativas, sem erro, que ainda não usaram o vídeo (nem outra cópia dele). */
export function republishAccountIds(args: {
  post: PostRow;
  accountIds: readonly string[];
  accountById: ReadonlyMap<string, AccountInfo>;
  usedKeysByAccount: ReadonlyMap<string, ReadonlySet<string>>;
  keyOf: VideoKeyResolver;
}): string[] {
  const videoKey = postVideoKey(args.post, args.keyOf);
  if (!videoKey) return [];
  return [...new Set(args.accountIds)].filter((id) => {
    const account = args.accountById.get(id);
    if (!account || !isAccountUsable(account)) return false;
    if (account.igAccountKey === args.post.igAccountKey) return false;
    return !args.usedKeysByAccount.get(id)?.has(videoKey);
  });
}

export interface HotSectionArgs {
  queue: QueueConfig;
  /** Posts da fila nos últimos 30 dias, já pontuados. */
  posts: readonly ScoredPost[];
  nowMs: number;
  cards: CardContext;
  usedKeysByAccount: ReadonlyMap<string, ReadonlySet<string>>;
  keyOf: VideoKeyResolver;
}

export function buildHotSection(args: HotSectionArgs): HotSection {
  const p90 = hotViewsThreshold(args.posts);
  const fromMs = args.nowMs - HOT_WINDOW_HOURS * HOUR_MS;
  const recentMature = args.posts.filter((sp) => sp.mature && sp.ms >= fromMs);

  const highlighted = recentMature
    .map((sp) => ({ sp, multiple: multipleOf(sp.post.views, sp.localNormal, 0) }))
    .filter(({ sp, multiple }) => isHot(multiple, sp.post.views as number, p90))
    .sort((a, b) => (b.multiple as number) - (a.multiple as number))
    .slice(0, HOT_MAX_HIGHLIGHTS)
    .map(({ sp }) => sp);

  const fallback =
    highlighted.length > 0
      ? null
      : recentMature.reduce<ScoredPost | null>(
          (best, sp) => (!best || (sp.post.views as number) > (best.post.views as number) ? sp : best),
          null,
        );

  const target = highlighted[0] ?? fallback;
  const republish = target
    ? republishAccountIds({
        post: target.post,
        accountIds: args.queue.accountIds,
        accountById: args.cards.accountById,
        usedKeysByAccount: args.usedKeysByAccount,
        keyOf: args.keyOf,
      })
    : [];

  const highlightedCards = highlighted.map((sp) => toPostCard(sp, args.cards));
  const fallbackCard = fallback ? toPostCard(fallback, args.cards) : null;
  return {
    highlighted: highlightedCards,
    fallback: fallbackCard,
    republishAccountIds: republish,
    text: hotText(highlightedCards[0] ?? null, fallbackCard),
  };
}

function hotText(top: PostCard | null, fallback: PostCard | null): { title: string; body: string } {
  if (top) {
    return { title: HOT_TITLE, body: hotHighlightText(top.username, top.views, top.multiple ?? 0, top.source === "loop") };
  }
  if (fallback) return { title: HOT_NONE_TITLE, body: hotFallbackText(fallback.username, fallback.views, fallback.multiple) };
  return { title: HOT_NONE_TITLE, body: HOT_EMPTY_TEXT };
}
