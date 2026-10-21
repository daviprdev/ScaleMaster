/**
 * Raio-X da fila — chave do vídeo e nota do vídeo (itens 1 e 3).
 *
 * Nota = mediana dos votos das contas; cada conta vota UMA vez com a mediana
 * dos múltiplos dela naquele vídeo. Assim um único post viral não carrega o
 * vídeo, e uma conta que postou o vídeo 5× não vale 5 votos.
 */

import { shortCodeFromUrl } from "../clone-media";
import type { AccountInfo, PostRow, VideoInfo, VideoScore, VideoStatus } from "./types";
import { MIN_SCORE, MIN_VOTING_ACCOUNTS } from "./constants";
import type { ScoredPost } from "./normals";
import { groupBy, mean, median, roundOrNull } from "./stats";

/** videoKey de um vídeo da Biblioteca: shortcode do source_url (reel/reels/p), senão o próprio id. */
export function videoKeyOf(videoId: string, sourceUrl: string | null | undefined): string {
  return (sourceUrl ? shortCodeFromUrl(sourceUrl) : null) ?? videoId;
}

/** video_id → videoKey. */
export type VideoKeyResolver = (videoId: string) => string;

/**
 * Primeiro a chave que o load gravou nos posts, depois o source_url da
 * Biblioteca, por fim o próprio id. Junta o mesmo Reel importado duas vezes.
 */
export function buildVideoKeyResolver(posts: readonly PostRow[], videos: readonly VideoInfo[]): VideoKeyResolver {
  const fromPosts = new Map<string, string>();
  for (const p of posts) if (p.videoId && p.videoKey) fromPosts.set(p.videoId, p.videoKey);
  const fromLibrary = new Map(videos.map((v) => [v.id, videoKeyOf(v.id, v.sourceUrl)]));
  return (id) => fromPosts.get(id) ?? fromLibrary.get(id) ?? id;
}

/** Chave do vídeo do post; post sem video_id (vídeo apagado) fica fora da nota. */
export function postVideoKey(post: PostRow, keyOf: VideoKeyResolver): string | null {
  if (!post.videoId) return null;
  return post.videoKey ?? keyOf(post.videoId);
}

/**
 * account_id → videoKeys que a conta já usou. Junta usedVideoIdsByAccount
 * (inclui agendados) com os posts conhecidos, por conta no Instagram: conta
 * reconectada herda o que a conexão antiga já postou.
 */
export function buildUsedVideoKeys(
  usedVideoIdsByAccount: Readonly<Record<string, readonly string[]>>,
  accounts: readonly AccountInfo[],
  posts: readonly PostRow[],
  keyOf: VideoKeyResolver,
): Map<string, Set<string>> {
  const igOf = new Map(accounts.map((a) => [a.id, a.igAccountKey]));
  const byIg = new Map<string, Set<string>>();
  const add = (ig: string, key: string) => {
    const set = byIg.get(ig);
    if (set) set.add(key);
    else byIg.set(ig, new Set([key]));
  };
  for (const [accountId, ids] of Object.entries(usedVideoIdsByAccount)) {
    const ig = igOf.get(accountId) ?? accountId;
    for (const id of ids ?? []) add(ig, keyOf(id));
  }
  for (const post of posts) {
    const key = postVideoKey(post, keyOf);
    if (key) add(post.igAccountKey, key);
  }
  return new Map(accounts.map((a) => [a.id, byIg.get(a.igAccountKey) ?? new Set<string>()]));
}

/** Um voto por conta: mediana dos múltiplos (posts maduros com normal local ≥ 30) daquela conta. */
export function accountVotes(posts: readonly ScoredPost[]): number[] {
  const byAccount = groupBy(
    posts.filter((sp) => sp.mature && sp.multiple != null),
    (sp) => sp.post.igAccountKey,
  );
  const votes: number[] = [];
  for (const list of byAccount.values()) {
    const vote = median(list.map((sp) => sp.multiple as number));
    if (vote != null) votes.push(vote);
  }
  return votes;
}

/** Status do vídeo (item 3). Apagado e fora da pasta vêm antes da régua. */
export function videoStatus(args: {
  exists: boolean;
  inFolder: boolean;
  votingAccounts: number;
  score: number | null;
}): VideoStatus {
  if (!args.exists) return "removed";
  if (!args.inFolder) return "not_in_folder";
  if (args.votingAccounts < MIN_VOTING_ACCOUNTS) return "few_accounts";
  if (args.score == null || args.score < MIN_SCORE) return "below_bar";
  return "passes";
}

/** Ranking: score desc, votingAccounts desc, matureViewsMedian desc. */
export function compareVideoScores(a: VideoScore, b: VideoScore): number {
  return (
    desc(a.score, b.score) ||
    b.votingAccounts - a.votingAccounts ||
    desc(a.matureViewsMedian, b.matureViewsMedian) ||
    a.videoKey.localeCompare(b.videoKey)
  );
}

function desc(a: number | null, b: number | null): number {
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  return b - a;
}

export interface ScoreVideosArgs {
  /** Posts DESTA fila na janela de 14 dias, já pontuados. */
  posts: readonly ScoredPost[];
  videos: readonly VideoInfo[];
  folderVideoIds: readonly string[];
  keyOf: VideoKeyResolver;
}

/** Nota de todos os vídeos que rodaram na fila, em ordem de ranking (todos os status). */
export function scoreVideos(args: ScoreVideosArgs): VideoScore[] {
  const videoById = new Map(args.videos.map((v) => [v.id, v]));
  const folder = new Set(args.folderVideoIds);
  const libraryIdsByKey = groupBy(args.videos, (v) => args.keyOf(v.id));
  const groups = groupBy(args.posts, (sp) => postVideoKey(sp.post, args.keyOf));

  const scores: VideoScore[] = [];
  for (const [videoKey, group] of groups) {
    const votes = accountVotes(group);
    const score = median(votes);
    const matureViews = group.filter((sp) => sp.mature).map((sp) => sp.post.views as number);

    const lastPostMs = lastPostMsByVideoId(group);
    const candidateIds = new Set<string>([...lastPostMs.keys(), ...(libraryIdsByKey.get(videoKey) ?? []).map((v) => v.id)]);
    const existing = [...candidateIds].filter((id) => videoById.has(id));
    const inFolder = existing.filter((id) => folder.has(id));
    const videoId = pickMostRecent(inFolder.length > 0 ? inFolder : existing, lastPostMs);
    const video = videoId ? videoById.get(videoId) : undefined;

    scores.push({
      videoKey,
      videoId,
      publicUrl: video?.publicUrl ?? null,
      caption: video?.caption ?? null,
      score,
      votingAccounts: votes.length,
      accountsAboveNormal: votes.filter((v) => v >= 1).length,
      posts: group.length,
      matureViewsMedian: roundOrNull(median(matureViews)),
      matureViewsMean: roundOrNull(mean(matureViews)),
      status: videoStatus({
        exists: existing.length > 0,
        inFolder: inFolder.length > 0,
        votingAccounts: votes.length,
        score,
      }),
    });
  }
  return scores.sort(compareVideoScores);
}

function lastPostMsByVideoId(group: readonly ScoredPost[]): Map<string, number> {
  const last = new Map<string, number>();
  for (const sp of group) {
    const id = sp.post.videoId;
    if (!id) continue;
    last.set(id, Math.max(last.get(id) ?? -Infinity, sp.ms));
  }
  return last;
}

/**
 * Com mais de uma cópia do Reel, fica a de post mais recente nesta fila
 * (VideoInfo não traz created_at); empate mantém a ordem de chegada.
 */
function pickMostRecent(ids: readonly string[], lastPostMs: Map<string, number>): string | null {
  let best: string | null = null;
  let bestMs = -Infinity;
  for (const id of ids) {
    const ms = lastPostMs.get(id) ?? -Infinity;
    if (best == null || ms > bestMs) {
      best = id;
      bestMs = ms;
    }
  }
  return best;
}
