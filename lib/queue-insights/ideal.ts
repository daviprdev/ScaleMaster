/**
 * Monta a fila ideal a partir das entradas já calculadas (item 5). Puro e sem
 * dependência de servidor: o painel chama de novo no navegador quando o dono
 * mexe em N e M. Nada de Date.now() — o "agora" vem de inputs.nowIso.
 *
 * Rodízio (feito pelo distribute): na rodada k a conta da posição i recebe
 * videoIds[(i + k) mod N]. Cada conta passa por todos os N vídeos no ciclo,
 * então a grade é sempre N × M, sem depender da posição de ninguém.
 */

import type { AccountScore, BestHour, IdealInputs, IdealQueue, VideoScore } from "./types";
import {
  FAST_PACE_POSTS_PER_DAY,
  MAX_AUTO_STAGGER_SECONDS,
  MAX_IDEAL_VIDEOS,
  MAX_POSTS_PER_DAY,
  MINUTE_MS,
  MINUTES_PER_DAY,
  REPOST_WARN_BELOW,
  SHORT_QUEUE_VIDEOS,
  START_DELAY_MINUTES,
  START_ROUND_MINUTES,
} from "./constants";
import { clampInt, mean, ratio } from "./stats";
import { ceilToMinutes, nextBrtHourAtOrAfter, toMs } from "./time";
import { IDEAL_TITLE, idealText, repostWarning, shortQueueWarning, weakAccountsWarning } from "./texts";

/** Posts por dia por conta: clamp(round(1440 / intervalo), 1, 48). */
export function postsPerDayForInterval(intervalMinutes: number): number {
  if (!(intervalMinutes > 0)) return MAX_POSTS_PER_DAY;
  return clampInt(MINUTES_PER_DAY / intervalMinutes, 1, MAX_POSTS_PER_DAY);
}

/** Intervalo exibido: floor(1440 / postsPerDay) — o mesmo que o distribute usa. */
export function intervalForPostsPerDay(postsPerDay: number): number {
  return Math.floor(MINUTES_PER_DAY / postsPerDay);
}

/** Stagger do distribute: o customizado, ou min(300, floor(0.9 × intervalo × 60 ÷ (M − 1))). */
export function effectiveStaggerSeconds(intervalMinutes: number, m: number, custom: number | null): number | null {
  if (custom != null && custom > 0) return custom;
  if (m <= 1) return null;
  return Math.min(MAX_AUTO_STAGGER_SECONDS, Math.floor((0.9 * intervalMinutes * 60) / (m - 1)));
}

/** Com mais contas que vídeos, o mesmo vídeo volta a sair N × stagger segundos depois em outra conta. */
export function sameVideoGapSeconds(n: number, m: number, staggerSeconds: number | null): number | null {
  return m > n && staggerSeconds != null ? n * staggerSeconds : null;
}

export interface GridExpectation {
  postsPerCycle: number;
  alreadyPostedPairs: number;
  /** Média da grade de normal_atual × score × (repost ? r : 1); null sem conta com normal. */
  expectedPerPost: number | null;
}

/** A grade inteira N × M: cada conta posta cada vídeo uma vez por ciclo. */
export function gridExpectation(
  videos: readonly VideoScore[],
  accounts: readonly AccountScore[],
  usedVideoIdsByAccount: Readonly<Record<string, readonly string[]>>,
  repostFactor: number,
): GridExpectation {
  let alreadyPostedPairs = 0;
  const cells: number[] = [];
  for (const account of accounts) {
    const used = new Set(usedVideoIdsByAccount[account.accountId] ?? []);
    for (const video of videos) {
      const repost = video.videoId != null && used.has(video.videoId);
      if (repost) alreadyPostedPairs++;
      if (account.currentNormal == null) continue;
      cells.push(account.currentNormal * (video.score ?? 1) * (repost ? repostFactor : 1));
    }
  }
  return { postsPerCycle: videos.length * accounts.length, alreadyPostedPairs, expectedPerPost: mean(cells) };
}

/** Média dos scores das horas floor(s + k × intervalo/60) mod 24, k = 0…steps−1; hora sem score vale 1,0. */
export function phaseScore(
  startHour: number,
  hourScores: Readonly<Record<number, number>>,
  intervalMinutes: number,
  steps: number,
): number {
  const scores: number[] = [];
  for (let k = 0; k < Math.max(1, steps); k++) {
    const hour = Math.floor(startHour + (k * intervalMinutes) / 60) % 24;
    scores.push(hourScores[hour] ?? 1);
  }
  return mean(scores) as number;
}

export interface StartChoice {
  startAt: string;
  startHour: number | null;
  phaseScore: number | null;
}

/**
 * Início (item 6). Com 12+ posts/dia ou sem melhor horário: agora + 10 min
 * (múltiplo de 5 min). Senão a fase s que maximiza o score das horas que a
 * conta vai cobrir, na próxima s:00 BRT ≥ agora + 10 min (empate: a mais cedo).
 */
export function chooseStart(args: {
  nowIso: string;
  postsPerDay: number;
  intervalMinutes: number;
  n: number;
  bestHour: BestHour | null;
}): StartChoice {
  const earliestMs = toMs(args.nowIso) + START_DELAY_MINUTES * MINUTE_MS;
  if (!args.bestHour || args.postsPerDay >= FAST_PACE_POSTS_PER_DAY) {
    return { startAt: new Date(ceilToMinutes(earliestMs, START_ROUND_MINUTES)).toISOString(), startHour: null, phaseScore: null };
  }
  const steps = Math.min(args.n, args.postsPerDay);
  let best: { hour: number; score: number; atMs: number } | null = null;
  for (let hour = 0; hour < 24; hour++) {
    const score = phaseScore(hour, args.bestHour.hourScores, args.intervalMinutes, steps);
    const atMs = nextBrtHourAtOrAfter(hour, earliestMs);
    const better = !best || score > best.score + 1e-9 || (Math.abs(score - best.score) <= 1e-9 && atMs < best.atMs);
    if (better) best = { hour, score, atMs };
  }
  const chosen = best as { hour: number; score: number; atMs: number };
  return { startAt: new Date(chosen.atMs).toISOString(), startHour: chosen.hour, phaseScore: chosen.score };
}

function idealWarnings(args: {
  n: number;
  cycleMinutes: number;
  repostFactor: number;
  alreadyPostedPairs: number;
  postsPerCycle: number;
  accounts: readonly AccountScore[];
}): string[] {
  const warnings: string[] = [];
  if (args.n > 0 && args.n < SHORT_QUEUE_VIDEOS) warnings.push(shortQueueWarning(args.n, args.cycleMinutes));
  if (args.repostFactor < REPOST_WARN_BELOW && args.alreadyPostedPairs > 0) {
    warnings.push(repostWarning(args.repostFactor, args.alreadyPostedPairs, args.postsPerCycle));
  }
  const weak = args.accounts.filter((a) => a.status !== "good").length;
  if (weak > 0) warnings.push(weakAccountsWarning(weak));
  return warnings;
}

/**
 * Fila ideal com os N primeiros vídeos que passam e as M primeiras contas do
 * ranking. N vai de 1 até os vídeos que passam (máx. 50, limite do distribute);
 * M de 1 até as contas que podem postar (fora do ar nunca entram).
 */
export function buildIdealQueue(inputs: IdealInputs, n: number, m: number): IdealQueue {
  const videos = inputs.videos.filter((v) => v.videoId != null);
  const accounts = inputs.accounts.filter((a) => a.status !== "inactive");
  const nn = videos.length === 0 ? 0 : clampInt(n, 1, Math.min(videos.length, MAX_IDEAL_VIDEOS));
  const mm = accounts.length === 0 ? 0 : clampInt(m, 1, accounts.length);
  const chosenVideos = videos.slice(0, nn);
  const chosenAccounts = accounts.slice(0, mm);

  const postsPerDay =
    inputs.postsPerDay > 0
      ? clampInt(inputs.postsPerDay, 1, MAX_POSTS_PER_DAY)
      : postsPerDayForInterval(inputs.intervalMinutes);
  const intervalMinutes = intervalForPostsPerDay(postsPerDay);
  const cycleMinutes = nn * intervalMinutes;
  const stagger = effectiveStaggerSeconds(intervalMinutes, mm, inputs.accountStaggerSeconds);

  const grid = gridExpectation(chosenVideos, chosenAccounts, inputs.usedVideoIdsByAccount, inputs.repostFactor);
  const videosFactor = ratio(mean(chosenVideos.map((v) => v.score ?? 1)), inputs.currentMeanVideoScore);
  const accountNormals = chosenAccounts.map((a) => a.currentNormal).filter((v): v is number => v != null);
  const accountsFactor = ratio(mean(accountNormals), inputs.currentMeanAccountNormal);

  const start = chooseStart({ nowIso: inputs.nowIso, postsPerDay, intervalMinutes, n: nn, bestHour: inputs.bestHour });

  return {
    n: nn,
    m: mm,
    videoIds: chosenVideos.map((v) => v.videoId as string),
    accountIds: chosenAccounts.map((a) => a.accountId),
    postsPerCycle: grid.postsPerCycle,
    alreadyPostedPairs: grid.alreadyPostedPairs,
    expectedPerPost: grid.expectedPerPost,
    videosFactor,
    accountsFactor,
    intervalMinutes,
    postsPerDay,
    cycleMinutes,
    sameVideoGapSeconds: sameVideoGapSeconds(nn, mm, stagger),
    startAt: start.startAt,
    startHour: start.startHour,
    warnings: idealWarnings({
      n: nn,
      cycleMinutes,
      repostFactor: inputs.repostFactor,
      alreadyPostedPairs: grid.alreadyPostedPairs,
      postsPerCycle: grid.postsPerCycle,
      accounts: chosenAccounts,
    }),
    text: {
      title: IDEAL_TITLE,
      body: idealText({
        n: nn,
        m: mm,
        postsPerCycle: grid.postsPerCycle,
        intervalMinutes,
        postsPerDay,
        expectedPerPost: grid.expectedPerPost,
        currentTypicalPerPost: inputs.currentTypicalPerPost,
        currentObservedMedian: inputs.currentObservedMedian,
        videosFactor,
        accountsFactor,
        startAt: start.startAt,
        startHour: start.startHour,
        phaseScore: start.phaseScore,
        hasBestHour: inputs.bestHour != null,
      }),
    },
  };
}
