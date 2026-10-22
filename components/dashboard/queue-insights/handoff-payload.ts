/**
 * O que os dois botões do Raio-X mandam para o Postar (via saveHandoff).
 * Funções puras — o painel só grava o resultado e abre /dashboard/postar?ideal=<id>.
 */

// Caminhos relativos (não "@/"): o vitest do projeto não resolve o alias e este arquivo tem teste.
import type { IdealQueueHandoff } from "../../../lib/queue-insights/handoff";
import type { QueueInsightsResponse } from "../../../lib/queue-insights/types";

export type HandoffPayload = Omit<IdealQueueHandoff, "version" | "createdAt">;

/** O Postar nunca recebe um início a menos de 5 min de agora. */
const MIN_LEAD_MS = 5 * 60_000;
/** "Publicar nas outras contas": 5 min entre uma conta e a próxima. */
const REPUBLISH_STAGGER_SECONDS = 300;

function sourceQueue(data: QueueInsightsResponse): HandoffPayload["sourceQueue"] {
  return { source: data.queue.source, id: data.queue.id, label: data.queue.label };
}

/**
 * "Montar essa fila": vídeos e contas na ordem da fila ideal (a ordem define o
 * rodízio), ritmo da fila e o início sugerido — ou agora + 5 min, se a sugestão
 * já ficou para trás. null quando não há o que montar.
 */
export function idealHandoff(data: QueueInsightsResponse, now: Date = new Date()): HandoffPayload | null {
  const ideal = data.ideal;
  if (!ideal || ideal.videos.length === 0 || ideal.accounts.length === 0) return null;

  const earliest = now.getTime() + MIN_LEAD_MS;
  const suggested = new Date(ideal.startAt).getTime();
  const startAt = Number.isFinite(suggested) && suggested >= earliest ? ideal.startAt : new Date(earliest).toISOString();

  return {
    kind: "ideal",
    videoIds: ideal.videos.map((v) => v.videoId),
    accountIds: ideal.accounts.map((a) => a.accountId),
    postsPerDay: ideal.postsPerDay,
    startAt,
    defaults: data.queue.handoff,
    sourceQueue: sourceQueue(data),
    videos: ideal.videos.map((v) => ({ id: v.videoId, publicUrl: v.publicUrl, caption: v.caption })),
  };
}

/**
 * "Publicar nas outras contas": o vídeo do post quente nas contas da fila que
 * não postaram ele nas últimas 24h, começando em 5 min, 5 min entre contas.
 * null quando o vídeo saiu da Biblioteca ou não sobrou conta.
 */
export function republishHandoff(data: QueueInsightsResponse, now: Date = new Date()): HandoffPayload | null {
  const hot = data.hot;
  if (!hot?.videoId || hot.republishAccountIds.length === 0) return null;
  const videoId = hot.videoId;
  // A legenda (só para a lista do Postar) vem nos vídeos da fila ideal; fora dela, fica sem.
  const fromIdeal = data.ideal?.videos.find((v) => v.videoId === videoId);

  return {
    kind: "republish",
    videoIds: [videoId],
    accountIds: hot.republishAccountIds,
    postsPerDay: 1,
    startAt: new Date(now.getTime() + MIN_LEAD_MS).toISOString(),
    defaults: { ...data.queue.handoff, accountStaggerSeconds: REPUBLISH_STAGGER_SECONDS },
    sourceQueue: sourceQueue(data),
    videos: [{ id: videoId, publicUrl: hot.publicUrl ?? fromIdeal?.publicUrl ?? null, caption: fromIdeal?.caption ?? null }],
  };
}
