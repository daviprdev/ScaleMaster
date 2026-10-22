/**
 * Raio-X da fila — contratos compartilhados entre o cálculo (lib/queue-insights),
 * as rotas (app/api/queue-insights), o painel (components/dashboard/queue-insights)
 * e o modo "fila ideal" do Postar. Regras em docs/fila-ideal.md.
 *
 * O painel só LÊ. Nada aqui muda a distribuição automática: a fila ideal só vira
 * campanha quando o dono confirma no Postar.
 */

export type QueueSource = "postar" | "loop";

/** rodando | rodando com pasta de contas sincronizada | pausada | terminada. */
export type QueueState = "running" | "running_synced" | "paused" | "finished";

/** Uma entrada do seletor de filas (só filas rodando). */
export interface QueueListItem {
  source: QueueSource;
  id: string;
  /** "Loop · <nome>" ou "Postar · pasta <pasta> · <N> contas · desde dd/mm". */
  label: string;
  state: QueueState;
  accountCount: number;
  /** Minutos entre posts de uma mesma conta; null = Modo Ciclo (burst). */
  intervalMinutes: number | null;
  burstMode: boolean;
  publishedLast24h: number;
  createdAt: string;
}

/** Configuração da fila de origem que o Postar copia ao montar a fila ideal. */
export interface QueueHandoffDefaults {
  folderId: string | null;
  captionMode: "original" | "custom" | "none";
  captions: string[];
  autoCaptionType: string | null;
  stripHashtags: boolean;
  stripMentions: boolean;
  videoProcessingMode: string;
  shareToFeed: boolean;
  useProxyPool: boolean;
  /** null = automático (mesma regra do distribute). */
  accountStaggerSeconds: number | null;
}

/** Fila analisada, com os parâmetros que a fila ideal herda. */
export interface QueueConfig extends QueueListItem {
  folderId: string | null;
  folderName: string | null;
  /** Vídeos hoje na(s) pasta(s) da fila — só eles podem entrar na fila ideal. */
  folderVideoIds: string[];
  /** Contas configuradas na fila (campanha: contas dos posts + pastas sincronizadas; loop: loop_accounts ou pasta). */
  accountIds: string[];
  /** Máximo de vídeos por conta por ciclo (Postar: video_count, -1 = pasta; Loop: pasta ou media_limit/cycles). */
  videoCountCap: number;
  /** posts_per_day da campanha (Postar normal) ou round(1440/interval_minutes) (Loop); null em Modo Ciclo. */
  postsPerDay: number | null;
  handoff: QueueHandoffDefaults;
}

/** Post publicado normalizado das duas tabelas (scheduled_posts e pending_containers). */
export interface PostRow {
  source: QueueSource;
  postId: string;
  /** campaign_id (Postar) ou loop_id (Loop); null quando o post não é de fila. */
  queueId: string | null;
  accountId: string;
  /** Chave da conta no Instagram (ig_business_account_id ?? accountId) — conta reconectada continua a mesma. */
  igAccountKey: string;
  videoId: string | null;
  /** Chave do vídeo original: shortcode do source_url quando existe, senão o video_id. */
  videoKey: string | null;
  /** ISO. Postar: published_at. Loop: published_at, ou estimativa GREATEST(created_at, retry_after). */
  publishedAt: string;
  publishedAtEstimated: boolean;
  views: number | null;
  /** ISO da última leitura de views que deu certo (insights_plays_at ?? insights_fetched_at). */
  viewsReadAt: string | null;
  mediaId: string | null;
}

export interface AccountInfo {
  id: string;
  username: string;
  avatarUrl: string | null;
  isActive: boolean;
  healthStatus: string | null;
  igAccountKey: string;
}

export interface VideoInfo {
  id: string;
  publicUrl: string | null;
  caption: string | null;
  folderId: string | null;
  sourceUrl: string | null;
}

/** Tudo que o cálculo precisa; montado por lib/queue-insights/load.ts. */
export interface AnalyzeInput {
  queue: QueueConfig;
  /** Posts publicados (reels) DESTA fila, desde o começo dela (até 30 dias). */
  queuePosts: PostRow[];
  accounts: AccountInfo[];
  videos: VideoInfo[];
}

/** Linha de números do topo (igual ao Hotler). */
export interface Summary {
  /** ISO do começo da contagem: o início da fila (ou 30 dias numa fila mais antiga). */
  since: string;
  /** Reels publicados da fila. */
  posts: number;
  /** Soma das views. */
  totalViews: number;
  /** Média das views dos posts contados (com 1h+ de publicação e views lidas). */
  viewsPerPost: number | null;
  /** Maior views de um post da fila. */
  bestPostViews: number | null;
}

/** "Um post seu está indo muito bem agora". */
export interface HotPost {
  postId: string;
  source: QueueSource;
  accountId: string;
  username: string;
  avatarUrl: string | null;
  videoId: string | null;
  publicUrl: string | null;
  mediaId: string | null;
  views: number;
  publishedAt: string;
  /** Mediana das views desse vídeo nos posts contados da fila ("publicação típica dele"). */
  videoTypicalViews: number | null;
  /** Contas da fila (ativas, sem erro) que não publicaram esse vídeo nas últimas 24h. */
  republishAccountIds: string[];
  /** "108.834 views em 09/10 às 09h". */
  eyebrow: string;
  title: string;
  body: string;
}

export interface IdealVideo {
  videoId: string;
  publicUrl: string | null;
  caption: string | null;
  /** Média das views por post desse vídeo na fila. */
  avgViews: number;
  posts: number;
  accounts: number;
}

export interface IdealAccount {
  accountId: string;
  username: string;
  avatarUrl: string | null;
  /** Média das views por post dessa conta na fila. */
  avgViews: number;
  posts: number;
}

/** "A sua fila ideal, montada com o que já funciona". */
export interface IdealQueue {
  /** Em ordem de média — a ordem define o rodízio no Postar. */
  videos: IdealVideo[];
  /** Em ordem de média. */
  accounts: IdealAccount[];
  /** N × M. */
  postsPerCycle: number;
  /** Minutos entre posts de uma mesma conta (herdado da fila). */
  intervalMinutes: number;
  /** clamp(round(1440 / intervalo), 1, 48) — vai para o Postar. */
  postsPerDay: number;
  /** Views esperadas por publicação ("~868 views por publicação"). */
  expectedPerPost: number;
  /** Mediana das views por post da fila ("contra 29 do seu material mediano"). */
  medianPerPost: number | null;
  /** Hora BRT 0–23 em que as contas escolhidas mais renderam; null se não deu para medir. */
  bestHour: number | null;
  bestHourViews: number | null;
  /** "20/08": melhor dia da fila, quando nele nenhuma conta repetiu vídeo. */
  patternDay: string | null;
  /** ISO do início sugerido no Postar (próxima melhor hora ou agora + 10 min). */
  startAt: string;
  /** "~868 views por publicação". */
  eyebrow: string;
  title: string;
  body: string;
  footnote: string;
}

/** Resposta de GET /api/queue-insights/[source]/[id]. */
export interface QueueInsightsResponse {
  queue: QueueConfig;
  generatedAt: string;
  summary: Summary;
  /** null quando a fila ainda não tem post com views. */
  hot: HotPost | null;
  /** null quando ainda não dá para montar — o motivo vai em idealUnavailable. */
  ideal: IdealQueue | null;
  idealUnavailable: string | null;
}

/** Resposta de GET /api/queue-insights. */
export interface QueueListResponse {
  queues: QueueListItem[];
  /** Fila em que o painel abre: a campanha rodando com mais posts nas últimas 24h. */
  defaultQueue: { source: QueueSource; id: string } | null;
}
