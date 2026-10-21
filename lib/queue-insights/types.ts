/**
 * Raio-X da fila — contratos compartilhados entre o cálculo (lib/queue-insights),
 * as rotas (app/api/queue-insights), o painel (components/dashboard/queue-insights)
 * e o modo "fila ideal" do Postar.
 *
 * O painel só LÊ. Nada aqui muda a distribuição automática: a fila ideal só vira
 * campanha quando o dono confirma no Postar.
 */

export type QueueSource = "postar" | "loop";

/** rodando | rodando com pasta de contas sincronizada | pausada | terminada. */
export type QueueState = "running" | "running_synced" | "paused" | "finished";

/** Uma entrada do seletor de filas. */
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

/** Uma leitura de views guardada pelo trigger (post_views_snapshots). */
export interface SnapshotRow {
  postId: string;
  source: QueueSource;
  readAt: string;
  views: number;
}

/** Tudo que o cálculo precisa; montado por lib/queue-insights/load.ts. */
export interface AnalyzeInput {
  queue: QueueConfig;
  /** Posts desta fila nos últimos 30 dias. */
  queuePosts: PostRow[];
  /** Reels de TODAS as origens das contas da fila nos últimos 17 dias (14 + margem da janela local). */
  accountPosts: PostRow[];
  accounts: AccountInfo[];
  videos: VideoInfo[];
  /** Leituras guardadas dos posts da fila publicados nas últimas 48h (vazio sem o SQL). */
  snapshots: SnapshotRow[];
  /** account_id → video_ids que a conta já usou em qualquer origem (inclui agendados). */
  usedVideoIdsByAccount: Record<string, string[]>;
  /** Recursos do SQL manual que ainda não existem no banco. */
  missingSql: string[];
}

export interface PostCard {
  postId: string;
  source: QueueSource;
  accountId: string;
  username: string;
  avatarUrl: string | null;
  videoId: string | null;
  publicUrl: string | null;
  mediaId: string | null;
  views: number;
  /** views ÷ normal local da conta; null quando a conta não tem normal confiável. */
  multiple: number | null;
  publishedAt: string;
  viewsReadAt: string | null;
  /** "+380 views desde a leitura das 14h" — só com histórico. */
  risingText: string | null;
}

export interface HotSection {
  /** Até 3 posts fora da curva (≥5× o normal E ≥ p90 da fila), o 1º em destaque. */
  highlighted: PostCard[];
  /** Sem destaque: o melhor post maduro das últimas 48h. */
  fallback: PostCard | null;
  /** Contas da fila (ativas, sem erro) que nunca usaram o vídeo do 1º destaque (ou do fallback). */
  republishAccountIds: string[];
  text: { title: string; body: string };
}

export type VideoStatus = "passes" | "below_bar" | "few_accounts" | "removed" | "not_in_folder";

export interface VideoScore {
  videoKey: string;
  /** video_id que está na pasta da fila (o que vai para o Postar). */
  videoId: string | null;
  publicUrl: string | null;
  caption: string | null;
  /** Mediana dos votos das contas (cada voto = mediana dos múltiplos daquela conta). */
  score: number | null;
  votingAccounts: number;
  accountsAboveNormal: number;
  posts: number;
  matureViewsMedian: number | null;
  matureViewsMean: number | null;
  status: VideoStatus;
}

export type AccountStatus = "good" | "weak" | "no_data" | "inactive";

export interface AccountScore {
  accountId: string;
  username: string;
  avatarUrl: string | null;
  /** Normal ATUAL (mediana dos posts maduros dos últimos 3/7/14 dias, ≥20 posts). */
  currentNormal: number | null;
  normalWindowDays: 3 | 7 | 14 | null;
  postsInQueue: number;
  status: AccountStatus;
}

export interface BestHour {
  /** Hora BRT 0–23. */
  hour: number;
  /** Mediana do múltiplo na hora. */
  score: number;
  /** Mediana das views brutas na hora (das contas escolhidas se ≥5 posts, senão da fila). */
  typicalViews: number;
  /** Score por hora qualificada (≥10 posts e ≥3 contas); usado para escolher o início. */
  hourScores: Record<number, number>;
}

export interface DayPattern {
  /** YYYY-MM-DD (BRT). */
  date: string;
  accounts: number;
  posts: number;
  /** Mediana entre contas da mediana dos intervalos entre posts da conta no dia; null em Modo Ciclo/sem dado. */
  medianIntervalMinutes: number | null;
  /** p10–p90 da hora BRT dos posts. */
  hourFrom: number | null;
  hourTo: number | null;
  /** Mesma conta + mesmo vídeo 2× no dia. */
  repeatedSameDay: number;
  /** Posts em que a conta já tinha usado o vídeo antes (qualquer origem). */
  repeatedFromBefore: number;
  /** Contas que também postaram por outras filas nesse dia. */
  accountsAlsoInOtherQueues: number;
}

export interface BestDay extends DayPattern {
  medianMultiple: number;
  meanViews: number;
  medianViews: number;
  /** O padrão de hoje até agora (sem views — os posts de hoje ainda não amadureceram). */
  today: DayPattern | null;
}

export type ReadinessState = "collecting" | "few_good" | "no_accounts" | "ready" | "impossible";

export interface Readiness {
  state: ReadinessState;
  /** Vídeos com 3+ contas com post maduro nesta fila. */
  coveredVideos: number;
  passingVideos: number;
  /** Vídeos em só 1–2 contas. */
  videosInFewAccounts: number;
  postsAwaitingMatureRead: number;
  /** Previsão para o estado "collecting"; null quando não dá para estimar. */
  etaHours: number | null;
  message: string;
}

export interface Summary {
  windowDays: 30;
  /** ISO do início do resumo: o começo da fila, ou 30 dias atrás numa fila mais antiga. */
  since: string;
  posts: number;
  totalViews: number;
  /** Média dos posts maduros com views. */
  viewsPerPost: number | null;
  medianViews: number | null;
  bestPost: PostCard | null;
}

export interface Freshness {
  /** max(viewsReadAt) dos posts da fila. */
  viewsReadUntil: string | null;
  /** Posts da fila das últimas 48h ainda sem leitura de 4h. */
  awaitingMatureRead: number;
  /** Posts da fila (30 dias) de contas hoje inativas ou com erro — views congeladas. */
  frozenAccountPosts: number;
}

/** Entradas que o painel usa para recalcular a fila ideal no navegador quando o dono mexe em N e M. */
export interface IdealInputs {
  /** Vídeos que passam, em ordem de ranking. */
  videos: VideoScore[];
  /** Contas da fila em ordem de ranking (boas primeiro, depois as demais com aviso). */
  accounts: AccountScore[];
  defaultN: number;
  defaultM: number;
  maxN: number;
  /** Intervalo por conta que a fila ideal herda (minutos). */
  intervalMinutes: number;
  /** clamp(round(1440/intervalMinutes), 1, 48). */
  postsPerDay: number;
  accountStaggerSeconds: number | null;
  /** Fator do repost (mediana do múltiplo do 2º+ post ÷ 1º post da mesma conta). 1 até haver 30 pares. */
  repostFactor: number;
  repostPairs: number;
  /** account_id → video_ids já usados (para aplicar o repostFactor). */
  usedVideoIdsByAccount: Record<string, string[]>;
  /** A fila de hoje medida na mesma régua: média de normal_atual(conta) × score(vídeo) nos posts dos últimos 7 dias. */
  currentTypicalPerPost: number | null;
  currentMeanAccountNormal: number | null;
  currentMeanVideoScore: number | null;
  /** Mediana real observada da fila (posts maduros, 14 dias). */
  currentObservedMedian: number | null;
  bestHour: BestHour | null;
  /** Sugestão de início vinda da origem; recalculada por buildIdealQueue conforme N. */
  nowIso: string;
}

/** Resultado de buildIdealQueue (servidor e navegador). */
export interface IdealQueue {
  n: number;
  m: number;
  videoIds: string[];
  accountIds: string[];
  postsPerCycle: number;
  /** Pares em que a conta já tinha usado o vídeo (repost permitido, nunca 2× no mesmo ciclo). */
  alreadyPostedPairs: number;
  expectedPerPost: number | null;
  /** Quanto a mais por post vem dos vídeos e quanto das contas (fatores multiplicativos). */
  videosFactor: number | null;
  accountsFactor: number | null;
  intervalMinutes: number;
  postsPerDay: number;
  /** Duração do ciclo por conta = n × intervalo. */
  cycleMinutes: number;
  /** De quantos em quantos segundos o mesmo vídeo sai em outra conta na mesma rodada; null se m ≤ n. */
  sameVideoGapSeconds: number | null;
  /** ISO do início sugerido (próxima hora da melhor fase, ou agora + 10 min). */
  startAt: string;
  /** Hora BRT sugerida para o início, ou null quando o horário não faz diferença. */
  startHour: number | null;
  /** Aviso do repost (r < 0,8) ou de fila curta (n < 5). */
  warnings: string[];
  text: { title: string; body: string };
}

/** Resposta de GET /api/queue-insights/[source]/[id]. */
export interface QueueInsightsResponse {
  queue: QueueConfig;
  generatedAt: string;
  freshness: Freshness;
  summary: Summary;
  hot: HotSection;
  readiness: Readiness;
  videos: VideoScore[];
  accounts: AccountScore[];
  idealInputs: IdealInputs;
  /** null enquanto a régua não fecha (readiness ≠ ready). */
  ideal: IdealQueue | null;
  bestHour: BestHour | null;
  bestDay: BestDay | null;
  /** Carga por conta nas próximas 24h (publicados 24h + pendentes 24h + Loops ativos) — para o aviso do freio de ~50/dia. */
  accountLoad24h: Record<string, number>;
  missingSql: string[];
}

/** Resposta de GET /api/queue-insights. */
export interface QueueListResponse {
  queues: QueueListItem[];
  /** Fila em que o painel abre: a única rodando, ou a rodando com mais posts nas últimas 24h. */
  defaultQueue: { source: QueueSource; id: string } | null;
}
