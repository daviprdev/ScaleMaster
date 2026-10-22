/**
 * Aba Fila — cálculos puros (sem banco), compartilhados pela rota, pela tela
 * e pelo publish-scheduled. Regras em docs/fila-pausa.md.
 */

import type { FilaSummary, FilaVideo } from "./types";

// ---------------------------------------------------------------------------
// Números por vídeo
// ---------------------------------------------------------------------------

/** Post publicado de uma fila da pasta: só o que a conta precisa. */
export interface FilaPost {
  videoId: string | null;
  /** Leitura mais recente; null = ainda sem leitura (conta como 0). */
  views: number | null;
}

export interface FilaVideoInput {
  id: string;
  publicUrl: string | null;
  caption: string | null;
  createdAt: string | null;
  pausedAt: string | null;
}

/**
 * Posts, views e média (views ÷ posts) de cada vídeo da pasta, e o resumo das
 * filas. A média é a conta simples, igual à do print de referência: post ainda
 * sem leitura entra com 0. O resumo conta todos os posts das filas, inclusive
 * de vídeo que já saiu da pasta — é a média da fila, a régua do "abaixo da média".
 */
export function aggregateFila(
  videos: FilaVideoInput[],
  posts: FilaPost[],
): { videos: FilaVideo[]; summary: FilaSummary } {
  const byVideo = new Map<string, { posts: number; views: number }>();
  let totalViews = 0;
  for (const p of posts) {
    const views = p.views != null && Number.isFinite(p.views) ? Math.max(0, p.views) : 0;
    totalViews += views;
    if (!p.videoId) continue;
    const acc = byVideo.get(p.videoId) ?? { posts: 0, views: 0 };
    acc.posts++;
    acc.views += views;
    byVideo.set(p.videoId, acc);
  }

  const rows: FilaVideo[] = videos.map((v) => {
    const s = byVideo.get(v.id) ?? { posts: 0, views: 0 };
    return {
      id: v.id,
      publicUrl: v.publicUrl,
      caption: v.caption,
      createdAt: v.createdAt,
      posts: s.posts,
      views: s.views,
      avgViews: s.posts > 0 ? s.views / s.posts : null,
      pausedAt: v.pausedAt,
    };
  });

  return {
    videos: rows,
    summary: {
      posts: posts.length,
      views: totalViews,
      avgViews: posts.length > 0 ? totalViews / posts.length : null,
      videos: rows.length,
      paused: rows.filter((r) => r.pausedAt).length,
    },
  };
}

/** Média do vídeo abaixo da média da fila (só com posts dos dois lados). */
export function isBelowAverage(video: Pick<FilaVideo, "avgViews">, queueAvg: number | null): boolean {
  return video.avgViews != null && queueAvg != null && video.avgViews < queueAvg;
}

// ---------------------------------------------------------------------------
// Ordem e filtro da lista
// ---------------------------------------------------------------------------

export type FilaSort = "views_asc" | "views_desc" | "avg_asc" | "avg_desc" | "posts_desc";
export type FilaFilter = "all" | "active" | "paused";

export const FILA_SORTS: { value: FilaSort; label: string }[] = [
  { value: "views_asc", label: "Menos views primeiro" },
  { value: "views_desc", label: "Mais views primeiro" },
  { value: "avg_asc", label: "Menor média por post" },
  { value: "avg_desc", label: "Maior média por post" },
  { value: "posts_desc", label: "Mais posts primeiro" },
];

export function isFilaSort(value: unknown): value is FilaSort {
  return FILA_SORTS.some((s) => s.value === value);
}

/**
 * Vídeo sem post nenhum não tem número para comparar: fica sempre no fim, do
 * mais novo na pasta para o mais antigo. Empate desfeito pelo id (ordem estável).
 */
export function sortFilaVideos(videos: FilaVideo[], sort: FilaSort): FilaVideo[] {
  const key = (v: FilaVideo): number => {
    switch (sort) {
      case "views_asc":
        return v.views;
      case "views_desc":
        return -v.views;
      case "avg_asc":
        return v.avgViews ?? 0;
      case "avg_desc":
        return -(v.avgViews ?? 0);
      case "posts_desc":
        return -v.posts;
    }
  };
  const created = (v: FilaVideo) => (v.createdAt ? Date.parse(v.createdAt) || 0 : 0);
  return videos.slice().sort((a, b) => {
    const aEmpty = a.posts === 0;
    const bEmpty = b.posts === 0;
    if (aEmpty !== bEmpty) return aEmpty ? 1 : -1;
    if (aEmpty) return created(b) - created(a) || a.id.localeCompare(b.id);
    return key(a) - key(b) || a.id.localeCompare(b.id);
  });
}

export function filterFilaVideos(videos: FilaVideo[], filter: FilaFilter): FilaVideo[] {
  if (filter === "active") return videos.filter((v) => !v.pausedAt);
  if (filter === "paused") return videos.filter((v) => v.pausedAt);
  return videos;
}

// ---------------------------------------------------------------------------
// Post vencido de vídeo pausado → troca de vídeo (publish-scheduled)
// ---------------------------------------------------------------------------

export interface SwapCandidate {
  id: string;
  video_id: string | null;
}

/**
 * Com quem o post vencido de vídeo pausado troca de vídeo: os posts pendentes
 * POSTERIORES da mesma conta na mesma campanha, do mais distante para o mais
 * próximo (`later` já vem nessa ordem). Fica o primeiro com vídeo ativo que não
 * esteja saindo em outra conta da campanha na mesma hora (`busy` — mesmo vídeo
 * em várias contas na mesma janela é o padrão que a Meta suprime); sem nenhum
 * assim, o primeiro com vídeo ativo. null = nada para trocar (o post é cancelado).
 */
export function pickSwapTarget<T extends SwapCandidate>(
  later: T[],
  paused: ReadonlySet<string>,
  busy: ReadonlySet<string>,
): T | null {
  const active = later.filter((p) => p.video_id && !paused.has(p.video_id));
  return active.find((p) => !busy.has(p.video_id!)) ?? active[0] ?? null;
}
