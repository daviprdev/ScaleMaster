/**
 * Passagem painel → Postar.
 *
 * O painel grava a fila montada no localStorage e abre /dashboard/postar?ideal=<id>.
 * O Postar lê uma única vez, aplica e apaga. Nada vai para a URL além do id, então
 * não há limite de tamanho nem SQL envolvido. Expira em 30 min.
 */

import type { QueueHandoffDefaults, QueueSource } from "./types";

export const HANDOFF_KEY_PREFIX = "ideal-queue:";
export const HANDOFF_TTL_MS = 30 * 60_000;

export interface IdealQueueHandoff {
  version: 1;
  createdAt: string;
  /** "ideal" = Montar essa fila; "republish" = Publicar nas outras contas (1 vídeo). */
  kind: "ideal" | "republish";
  sourceQueue: { source: QueueSource; id: string; label: string };
  /** Em ordem de score — a ordem define o rodízio. */
  videoIds: string[];
  /** Em ordem de ranking — o rodízio depende da posição da conta. */
  accountIds: string[];
  /** 1–48. */
  postsPerDay: number;
  /** ISO. */
  startAt: string;
  defaults: QueueHandoffDefaults;
  /** Para mostrar a lista no Postar sem buscar de novo. */
  videos: { id: string; publicUrl: string | null; caption: string | null }[];
}

function storage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

/** Grava a fila e devolve o id para a URL; null se o navegador bloquear o storage. */
export function saveHandoff(payload: Omit<IdealQueueHandoff, "version" | "createdAt">): string | null {
  const s = storage();
  if (!s) return null;
  const id = Math.random().toString(36).slice(2, 10);
  const full: IdealQueueHandoff = { ...payload, version: 1, createdAt: new Date().toISOString() };
  try {
    s.setItem(HANDOFF_KEY_PREFIX + id, JSON.stringify(full));
    return id;
  } catch {
    return null;
  }
}

/** Lê e APAGA a fila. "expired" quando não existe mais ou passou de 30 min. */
export function takeHandoff(id: string): IdealQueueHandoff | "expired" {
  const s = storage();
  if (!s) return "expired";
  const key = HANDOFF_KEY_PREFIX + id;
  let raw: string | null = null;
  try {
    raw = s.getItem(key);
    s.removeItem(key);
  } catch {
    return "expired";
  }
  if (!raw) return "expired";
  try {
    const parsed = JSON.parse(raw) as IdealQueueHandoff;
    if (parsed?.version !== 1 || !Array.isArray(parsed.videoIds) || !Array.isArray(parsed.accountIds)) return "expired";
    if (Date.now() - new Date(parsed.createdAt).getTime() > HANDOFF_TTL_MS) return "expired";
    return parsed;
  } catch {
    return "expired";
  }
}
