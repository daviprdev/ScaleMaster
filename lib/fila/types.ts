/**
 * Aba Fila — contratos entre a leitura (lib/fila/load), as rotas
 * (app/api/fila) e a tela (app/dashboard/fila). Regras em docs/fila-pausa.md.
 *
 * A aba lista os vídeos de uma pasta da Biblioteca que tem fila rodando
 * (campanha do Postar ou Loop), com os números de cada vídeo NAS filas dessa
 * pasta, e liga/desliga o vídeo da fila (videos_library.queue_paused_at).
 */

import type { QueueSource } from "@/lib/queue-insights/types";

/** Fila rodando numa pasta. */
export interface FilaQueue {
  source: QueueSource;
  id: string;
  /** "Postar · pasta X · N contas · desde dd/mm" ou "Loop · <nome>" (mesmo rótulo do Raio-X). */
  label: string;
  accountCount: number;
  publishedLast24h: number;
  createdAt: string;
}

/** Pasta do seletor: só pastas com fila rodando. */
export interface FilaFolder {
  id: string;
  name: string;
  videoCount: number;
  queues: FilaQueue[];
}

export interface FilaListResponse {
  folders: FilaFolder[];
  /** Pasta da fila com mais posts nas últimas 24h (a mesma em que o Raio-X abre). */
  defaultFolderId: string | null;
}

/** Um vídeo da pasta com os números dele nas filas rodando da pasta. */
export interface FilaVideo {
  id: string;
  publicUrl: string | null;
  /** 1ª linha da legenda original (até 200 caracteres) — só para reconhecer o vídeo. */
  caption: string | null;
  createdAt: string | null;
  /** Reels publicados com o vídeo nas filas da pasta. */
  posts: number;
  /** Soma das views (leitura mais recente de cada post). */
  views: number;
  /** views ÷ posts; null sem posts. */
  avgViews: number | null;
  /** Pausado na aba Fila desde (ISO); null = ativo. */
  pausedAt: string | null;
}

export interface FilaSummary {
  /** Reels publicados pelas filas da pasta (inclui vídeo que já saiu da pasta). */
  posts: number;
  views: number;
  /** Média da fila: views ÷ posts; null sem posts. É a régua do "abaixo da média". */
  avgViews: number | null;
  videos: number;
  paused: number;
}

export interface FilaFolderResponse {
  folder: { id: string; name: string };
  queues: FilaQueue[];
  /** Começo da contagem (ISO): o início da fila mais antiga, até 30 dias atrás. */
  countingSince: string | null;
  summary: FilaSummary;
  videos: FilaVideo[];
  /** false = falta aplicar supabase/fila_pausa_videos.sql — os números aparecem, o botão de pausar não funciona. */
  pauseAvailable: boolean;
}
