/**
 * Raio-X da fila — prontidão (item 9): a régua já fecha?
 *
 * Ordem: impossível/coletando (menos de 3 vídeos cobertos) → sem contas boas
 * → poucos vídeos acima do normal → pronta.
 */

import type { QueueConfig, Readiness } from "./types";
import { HOUR_MS, MATURE_HOURS, MIN_READY_VIDEOS, MIN_VOTING_ACCOUNTS } from "./constants";
import type { ScoredPost } from "./normals";
import { groupBy } from "./stats";
import { toMs } from "./time";
import {
  READINESS_IMPOSSIBLE_TEXT,
  READINESS_NO_ACCOUNTS_TEXT,
  READINESS_NO_NORMALS_TEXT,
  collectingText,
  fewGoodText,
  readyText,
} from "./texts";
import { postVideoKey, type VideoKeyResolver } from "./videos";

export interface Coverage {
  /** videoKeys com 3+ contas com post maduro nesta fila. */
  coveredVideos: number;
  /** videoKeys com post maduro em só 1–2 contas. */
  videosInFewAccounts: number;
}

/** Cobertura dos vídeos pelos posts maduros da fila (14 dias). */
export function videoCoverage(posts: readonly ScoredPost[], keyOf: VideoKeyResolver): Coverage {
  const groups = groupBy(
    posts.filter((sp) => sp.mature),
    (sp) => postVideoKey(sp.post, keyOf),
  );
  let coveredVideos = 0;
  let videosInFewAccounts = 0;
  for (const list of groups.values()) {
    const accounts = new Set(list.map((sp) => sp.post.igAccountKey)).size;
    if (accounts >= MIN_VOTING_ACCOUNTS) coveredVideos++;
    else if (accounts > 0) videosInFewAccounts++;
  }
  return { coveredVideos, videosInFewAccounts };
}

/** Máximo de vídeos por conta no ciclo; −1/0 (pasta inteira) vira o nº de vídeos da pasta. */
export function resolveVideoCountCap(queue: Pick<QueueConfig, "videoCountCap" | "folderVideoIds">): number {
  return queue.videoCountCap > 0 ? queue.videoCountCap : queue.folderVideoIds.length;
}

/**
 * A configuração nunca põe o mesmo vídeo em 3 contas.
 * Postar: M × cap ÷ vídeos da pasta < 3. Loop: menos de 3 contas.
 */
export function isQueueImpossible(
  queue: Pick<QueueConfig, "source" | "accountIds" | "videoCountCap" | "folderVideoIds">,
): boolean {
  const accounts = new Set(queue.accountIds).size;
  if (accounts < MIN_VOTING_ACCOUNTS) return true;
  if (queue.source === "loop") return false;
  const folder = queue.folderVideoIds.length;
  if (folder === 0) return false;
  const cap = Math.min(resolveVideoCountCap(queue), folder);
  return (accounts * cap) / folder < MIN_VOTING_ACCOUNTS;
}

/**
 * Previsão do "coletando": 3 × V × I ÷ M + 4h − horas desde a criação.
 * V = vídeos da pasta, I = intervalo por conta (h), M = contas. null em Modo
 * Ciclo, com a fila parada ou quando o prazo já passou sem cobertura — aí não
 * dá para prometer nada.
 */
export function collectingEtaHours(
  queue: Pick<QueueConfig, "state" | "burstMode" | "intervalMinutes" | "folderVideoIds" | "videoCountCap" | "accountIds" | "createdAt">,
  nowMs: number,
): number | null {
  if (queue.state === "paused" || queue.state === "finished") return null;
  if (queue.burstMode || queue.intervalMinutes == null || queue.intervalMinutes <= 0) return null;
  const videos = queue.folderVideoIds.length || Math.max(0, queue.videoCountCap);
  const accounts = new Set(queue.accountIds).size;
  if (videos === 0 || accounts === 0) return null;
  const createdMs = toMs(queue.createdAt);
  const sinceHours = Number.isFinite(createdMs) ? (nowMs - createdMs) / HOUR_MS : 0;
  const eta = (MIN_VOTING_ACCOUNTS * videos * (queue.intervalMinutes / 60)) / accounts + MATURE_HOURS - sinceHours;
  return eta < 0 ? null : Math.round(eta);
}

export interface ReadinessArgs {
  queue: QueueConfig;
  coverage: Coverage;
  passingVideos: number;
  goodAccounts: number;
  /** Contas que podem postar e já têm normal atual (boas ou fracas). */
  accountsWithNormal: number;
  /** Posts da fila das últimas 48h ainda sem leitura de 4h. */
  awaitingMatureRead: number;
  nowMs: number;
}

export function computeReadiness(args: ReadinessArgs): Readiness {
  const { coverage, passingVideos, goodAccounts, awaitingMatureRead } = args;
  const base = {
    coveredVideos: coverage.coveredVideos,
    passingVideos,
    videosInFewAccounts: coverage.videosInFewAccounts,
    postsAwaitingMatureRead: awaitingMatureRead,
    etaHours: null,
  };

  if (coverage.coveredVideos < MIN_READY_VIDEOS) {
    if (isQueueImpossible(args.queue)) return { ...base, state: "impossible", message: READINESS_IMPOSSIBLE_TEXT };
    const etaHours = collectingEtaHours(args.queue, args.nowMs);
    return {
      ...base,
      state: "collecting",
      etaHours,
      message: collectingText(coverage.coveredVideos, coverage.videosInFewAccounts, awaitingMatureRead, etaHours),
    };
  }
  if (goodAccounts === 0) {
    const message = args.accountsWithNormal === 0 ? READINESS_NO_NORMALS_TEXT : READINESS_NO_ACCOUNTS_TEXT;
    return { ...base, state: "no_accounts", message };
  }
  if (passingVideos < MIN_READY_VIDEOS) {
    return { ...base, state: "few_good", message: fewGoodText(coverage.coveredVideos, passingVideos) };
  }
  return { ...base, state: "ready", message: readyText(passingVideos, goodAccounts) };
}
