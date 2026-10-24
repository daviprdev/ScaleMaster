/**
 * Raio-X da fila — leitura do banco.
 *
 * Monta o AnalyzeInput de UMA fila (campanha do Postar ou Loop) para
 * analyzeQueue e a lista do seletor de filas. Só LÊ: nada aqui grava no banco
 * nem mexe na distribuição. Regras em docs/fila-ideal.md.
 *
 * Velocidade: um Loop de 50 contas a cada 30 min passa de 70 mil posts em 30
 * dias, e o PostgREST corta toda resposta em 1000 linhas. Cada leitura grande
 * pede a contagem exata antes (head) e busca as páginas em paralelo, com
 * colunas mínimas e um limite único de requisições simultâneas para o load
 * inteiro (nada de 40 páginas disparando de uma vez contra o Supabase).
 *
 * SQL manual (supabase/fila_ideal.sql, aplicado em 21/10/2026): se uma coluna
 * nova faltar no banco, a leitura refaz sem ela e o cálculo cai nas
 * estimativas (published_at do Loop por created_at/retry_after,
 * insights_fetched_at no lugar de insights_plays_at, campanha sem video_ids).
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { brtDateKey } from "@/lib/brt-time";
import { shortCodeFromUrl } from "@/lib/clone-media";
import { normalizeCaptionMode } from "@/lib/reel-captions";
import { normalizeProcessingMode } from "@/lib/video-processing";
import type {
  AccountInfo,
  AnalyzeInput,
  PostRow,
  QueueConfig,
  QueueHandoffDefaults,
  QueueListItem,
  QueueListResponse,
  QueueSource,
  QueueState,
  VideoInfo,
} from "./types";

const H = 60 * 60_000;
const D = 24 * H;

/** Posts da fila desde o começo dela, até 30 dias (docs/fila-ideal.md). */
const QUEUE_POSTS_DAYS = 30;
/** O container do Loop nasce antes da publicação (processamento, backoff): margem na busca por created_at. */
const LOOP_CREATED_MARGIN_MS = D;

/** Teto de linhas por resposta do PostgREST. */
const PAGE = 1000;
/** Requisições simultâneas por load (contagens, páginas, RPCs). */
const CONCURRENCY = 6;
/** Tamanho dos `.in()` — 150 uuids cabem folgado na URL. */
const IN_CHUNK = 150;

// ---------------------------------------------------------------------------
// Linhas do banco (só as colunas lidas)
// ---------------------------------------------------------------------------

interface AccountDb {
  id: string;
  username: string | null;
  avatar_url: string | null;
  is_active: boolean | null;
  health_status: string | null;
  ig_business_account_id: string | null;
  folder_id: string | null;
}

interface CampaignDb {
  id: string;
  status: string | null;
  account_folder_ids: string[] | null;
  video_folder_id: string | null;
  video_count: number | null;
  posts_per_day: number | null;
  captions: string[] | null;
  auto_caption_enabled: boolean | null;
  auto_caption_type: string | null;
  caption_mode: string | null;
  caption_strip_hashtags: boolean | null;
  caption_strip_mentions: boolean | null;
  account_stagger_seconds: number | null;
  burst_mode: boolean | null;
  video_processing_mode: string | null;
  share_to_feed: boolean | null;
  use_proxy_pool: boolean | null;
  created_at: string;
}

interface LoopDb {
  id: string;
  name: string | null;
  status: string | null;
  folder_id: string | null;
  account_folder_id: string | null;
  is_infinite: boolean | null;
  cycles: number | null;
  media_limit: number | null;
  interval_minutes: number | null;
  captions: string[] | null;
  auto_caption_enabled: boolean | null;
  auto_caption_type: string | null;
  caption_mode: string | null;
  caption_strip_hashtags: boolean | null;
  caption_strip_mentions: boolean | null;
  account_stagger_seconds: number | null;
  video_processing_mode: string | null;
  share_to_feed: boolean | null;
  use_proxy_pool: boolean | null;
  created_at: string;
  loop_accounts: { account_id: string }[] | null;
}

interface ScheduledDb {
  id: string;
  account_id: string;
  campaign_id: string | null;
  video_id: string | null;
  published_at: string;
  insights_plays: number | null;
  insights_fetched_at: string | null;
  insights_plays_at?: string | null;
  media_id: string | null;
}

interface ContainerDb {
  id: string;
  account_id: string;
  loop_id: string | null;
  video_id: string | null;
  ig_business_account_id: string | null;
  created_at: string;
  retry_after: string | null;
  published_at?: string | null;
  insights_plays: number | null;
  insights_fetched_at: string | null;
  insights_plays_at?: string | null;
  media_id: string | null;
}

interface VideoDb {
  id: string;
  public_url: string | null;
  caption?: string | null;
  folder_id: string | null;
  source_url: string | null;
  created_at: string | null;
}

interface DbError {
  code?: string | null;
  message?: string | null;
  details?: string | null;
}

// O client não tem os tipos gerados do banco: os builders do PostgREST
// circulam como `any`, como nas rotas.
type Query = any;
type Filter = (q: Query) => Query;

/** Resposta do PostgREST com as linhas como `any` (a consulta é montada em tempo de execução). */
interface DbResult {
  data: any;
  error: DbError | null;
  count?: number | null;
}

// ---------------------------------------------------------------------------
// Utilitários
// ---------------------------------------------------------------------------

export interface Limiter {
  run<T>(task: () => PromiseLike<T>): Promise<T>;
  /** Requisições feitas — só para o log de tempo. */
  readonly requests: number;
}

/** Fila de requisições com no máximo `max` em voo. Só envolve chamadas-folha (nunca outra função limitada). */
export function createLimiter(max: number): Limiter {
  let active = 0;
  let requests = 0;
  const waiting: (() => void)[] = [];
  const release = () => {
    active--;
    const next = waiting.shift();
    if (next) next();
  };
  return {
    run<T>(task: () => PromiseLike<T>): Promise<T> {
      return new Promise<T>((resolve, reject) => {
        const start = () => {
          active++;
          requests++;
          Promise.resolve()
            .then(task)
            .then(resolve, reject)
            .then(release);
        };
        if (active < max) start();
        else waiting.push(start);
      });
    },
    get requests() {
      return requests;
    },
  };
}

/** Dispara já e deixa para aguardar depois sem virar unhandled rejection se outro passo falhar antes. */
function started<T>(p: Promise<T>): Promise<T> {
  p.catch(() => undefined);
  return p;
}

/** id de fila/conta/post — também protege os filtros montados com ele. */
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

function uniq<T>(items: Iterable<T>): T[] {
  return Array.from(new Set(items));
}

function toIso(value: string | number | Date): string {
  return new Date(value).toISOString();
}

function ms(iso: string | null | undefined): number {
  return iso ? Date.parse(iso) : NaN;
}

/** O item de data mais recente; item sem data não conta. */
function latestBy<T>(items: T[], at: (item: T) => string | null): { item: T; at: number } | null {
  let best: { item: T; at: number } | null = null;
  for (const item of items) {
    const t = ms(at(item));
    if (Number.isFinite(t) && (!best || t > best.at)) best = { item, at: t };
  }
  return best;
}

/** Coluna/tabela do SQL manual ainda não criada (Postgres 42703/42P01, PostgREST PGRST204/PGRST205). */
export function isMissingSchemaError(err: DbError | null | undefined): boolean {
  if (!err) return false;
  if (["42703", "42P01", "PGRST204", "PGRST205"].includes(err.code ?? "")) return true;
  return /does not exist|schema cache|could not find the/i.test(`${err.message ?? ""} ${err.details ?? ""}`);
}

/** Falha de leitura com o erro do PostgREST junto (para reconhecer coluna que falta). */
class DbReadError extends Error {
  constructor(message: string, readonly dbError: DbError) {
    super(message);
  }
}

/**
 * Todas as linhas de uma consulta: contagem exata (head) e páginas de 1000 em
 * paralelo, ordenadas por id. Se entrou linha entre a contagem e as páginas, a
 * última volta cheia e a leitura segue até uma página curta; o id desfaz
 * duplicatas de borda.
 */
export async function fetchPaged<T extends { id: string | number }>(
  admin: SupabaseClient,
  lim: Limiter,
  table: string,
  columns: string,
  filter: Filter,
): Promise<T[]> {
  const head = await lim.run<DbResult>(() => filter(admin.from(table).select("id", { count: "exact", head: true })));
  if (head.error) throw new DbReadError(`contagem de ${table} falhou: ${head.error.message}`, head.error);
  const total = (head.count as number | null) ?? 0;
  if (!total) return [];

  const page = async (i: number): Promise<T[]> => {
    const res = await lim.run<DbResult>(() =>
      filter(admin.from(table).select(columns))
        .order("id", { ascending: true })
        .range(i * PAGE, (i + 1) * PAGE - 1),
    );
    if (res.error) throw new DbReadError(`leitura de ${table} falhou: ${res.error.message}`, res.error);
    return (res.data ?? []) as T[];
  };

  const pages = Math.ceil(total / PAGE);
  const results = await Promise.all(Array.from({ length: pages }, (_, i) => page(i)));
  let next = pages;
  let last = results[results.length - 1];
  while (last.length === PAGE) {
    last = await page(next++);
    results.push(last);
  }

  const seen = new Set<string | number>();
  const out: T[] = [];
  for (const rows of results) {
    for (const row of rows) {
      if (seen.has(row.id)) continue;
      seen.add(row.id);
      out.push(row);
    }
  }
  return out;
}

// Colunas do SQL manual: faltando, a tabela fica lembrada por 1 min (para não
// errar toda leitura e para enxergar logo depois de aplicado).
const newColumnsMissingAt = new Map<string, number>();
const MISSING_RETRY_MS = 60_000;

/** fetchPaged com as colunas novas; se o banco não tiver alguma, refaz só com as antigas. */
async function fetchPagedWithNewColumns<T extends { id: string | number }>(
  admin: SupabaseClient,
  lim: Limiter,
  table: string,
  baseColumns: string[],
  newColumns: string[],
  filter: Filter,
): Promise<T[]> {
  const missingAt = newColumnsMissingAt.get(table);
  if (missingAt === undefined || Date.now() - missingAt >= MISSING_RETRY_MS) {
    try {
      const rows = await fetchPaged<T>(admin, lim, table, [...baseColumns, ...newColumns].join(", "), filter);
      newColumnsMissingAt.delete(table);
      return rows;
    } catch (e) {
      if (!(e instanceof DbReadError) || !isMissingSchemaError(e.dbError)) throw e;
      newColumnsMissingAt.set(table, Date.now());
      console.warn(`[queue-insights] ${table} sem ${newColumns.join("/")} (SQL manual pendente) — usando as estimativas`);
    }
  }
  return fetchPaged<T>(admin, lim, table, baseColumns.join(", "), filter);
}

// ---------------------------------------------------------------------------
// Estado, rótulo e ritmo — compartilhados pela lista e pelo Raio-X
// ---------------------------------------------------------------------------

/** Postar normal: floor(1440 / posts_per_day); Modo Ciclo: null. */
function campaignInterval(c: Pick<CampaignDb, "burst_mode" | "posts_per_day">): number | null {
  if (c.burst_mode) return null;
  return Math.floor(1440 / Math.max(1, c.posts_per_day ?? 1));
}

function isSyncedCampaign(c: Pick<CampaignDb, "account_folder_ids" | "burst_mode">): boolean {
  return (c.account_folder_ids ?? []).length > 0 && !c.burst_mode;
}

/**
 * Pausada = status 'paused'. Sincronizada com pasta de contas e viva (posts em
 * voo ou publicação nas últimas 2× o intervalo — o cron cria 1 post por vez,
 * então entre um post e outro ela pode não ter nada pendente) = running_synced.
 * Com posts pendentes/publicando = running. O resto terminou.
 */
function campaignState(
  c: Pick<CampaignDb, "status" | "account_folder_ids" | "burst_mode" | "posts_per_day">,
  inflight: number,
  lastPublishedAt: string | null,
  nowMs: number,
): QueueState {
  const status = c.status ?? "active";
  if (status === "paused") return "paused";
  if (status !== "active") return "finished";
  const interval = campaignInterval(c);
  const recent =
    interval !== null && !!lastPublishedAt && nowMs - ms(lastPublishedAt) <= 2 * interval * 60_000;
  if (isSyncedCampaign(c) && (inflight > 0 || recent)) return "running_synced";
  if (inflight > 0) return "running";
  return "finished";
}

function loopState(status: string | null): QueueState {
  if (status === "active") return "running";
  if (status === "paused") return "paused";
  return "finished";
}

function isRunning(state: QueueState): boolean {
  return state === "running" || state === "running_synced";
}

/** dd/mm do dia BRT. */
function brtDayMonth(iso: string): string {
  const [, m, d] = brtDateKey(iso).split("-");
  return `${d}/${m}`;
}

function postarLabel(folderName: string | null, accountCount: number, createdAt: string): string {
  const contas = accountCount === 1 ? "1 conta" : `${accountCount} contas`;
  return `Postar · pasta ${folderName ?? "apagada"} · ${contas} · desde ${brtDayMonth(createdAt)}`;
}

function loopLabel(name: string | null): string {
  return `Loop · ${name?.trim() || "Meu Loop"}`;
}

/** Contas do Loop: a pasta de contas manda quando existe (mesma regra do process-loops), senão loop_accounts. */
function loopAccountIds(
  loop: Pick<LoopDb, "account_folder_id" | "loop_accounts">,
  accounts: Pick<AccountDb, "id" | "folder_id">[],
): string[] {
  if (loop.account_folder_id) {
    return accounts.filter((a) => a.folder_id === loop.account_folder_id).map((a) => a.id);
  }
  const owned = new Set(accounts.map((a) => a.id));
  return uniq((loop.loop_accounts ?? []).map((la) => la.account_id)).filter((id) => owned.has(id));
}

function handoffDefaults(
  row: Pick<
    CampaignDb,
    | "captions"
    | "auto_caption_enabled"
    | "auto_caption_type"
    | "caption_mode"
    | "caption_strip_hashtags"
    | "caption_strip_mentions"
    | "account_stagger_seconds"
    | "video_processing_mode"
    | "share_to_feed"
    | "use_proxy_pool"
  >,
  folderId: string | null,
): QueueHandoffDefaults {
  return {
    folderId,
    captionMode: normalizeCaptionMode(row.caption_mode),
    captions: (row.captions ?? []).filter((c) => typeof c === "string" && c.trim()),
    autoCaptionType: row.auto_caption_enabled ? (row.auto_caption_type ?? null) : null,
    stripHashtags: row.caption_strip_hashtags === true,
    stripMentions: row.caption_strip_mentions === true,
    videoProcessingMode: normalizeProcessingMode(row.video_processing_mode),
    // NULL = configuração anterior à opção; o Postar abre em Reels + grade.
    shareToFeed: row.share_to_feed !== false,
    useProxyPool: row.use_proxy_pool === true,
    accountStaggerSeconds: row.account_stagger_seconds ?? null,
  };
}

// ---------------------------------------------------------------------------
// Posts da fila → PostRow
// ---------------------------------------------------------------------------

/** insights_plays_at (só leituras que trouxeram views) ?? insights_fetched_at (anda até quando a Meta falha). */
function viewsReadAt(r: { insights_plays_at?: string | null; insights_fetched_at: string | null }): string | null {
  const at = r.insights_plays_at || r.insights_fetched_at;
  return at ? toIso(at) : null;
}

function fromScheduled(r: ScheduledDb, accountById: Map<string, AccountDb>): PostRow {
  return {
    source: "postar",
    postId: r.id,
    queueId: r.campaign_id ?? null,
    accountId: r.account_id,
    igAccountKey: accountById.get(r.account_id)?.ig_business_account_id || r.account_id,
    videoId: r.video_id ?? null,
    videoKey: null, // preenchido depois de ler os vídeos
    publishedAt: toIso(r.published_at),
    publishedAtEstimated: false,
    views: r.insights_plays ?? null,
    viewsReadAt: viewsReadAt(r),
    mediaId: r.media_id || null,
  };
}

/** Loop: published_at quando existe; senão GREATEST(created_at, retry_after) — erro de ~3 min. */
function fromContainer(r: ContainerDb, accountById: Map<string, AccountDb>): PostRow {
  const created = ms(r.created_at);
  const retry = ms(r.retry_after);
  const estimated = Number.isFinite(retry) && retry > created ? retry : created;
  return {
    source: "loop",
    postId: r.id,
    queueId: r.loop_id ?? null,
    accountId: r.account_id,
    igAccountKey: accountById.get(r.account_id)?.ig_business_account_id || r.ig_business_account_id || r.account_id,
    videoId: r.video_id ?? null,
    videoKey: null,
    publishedAt: r.published_at ? toIso(r.published_at) : toIso(estimated),
    publishedAtEstimated: !r.published_at,
    views: r.insights_plays ?? null,
    viewsReadAt: viewsReadAt(r),
    mediaId: r.media_id || null,
  };
}

const SCHEDULED_COLUMNS = [
  "id", "account_id", "campaign_id", "video_id", "published_at",
  "insights_plays", "insights_fetched_at", "media_id",
];
const SCHEDULED_NEW_COLUMNS = ["insights_plays_at"];

const CONTAINER_COLUMNS = [
  "id", "account_id", "loop_id", "video_id", "ig_business_account_id", "created_at", "retry_after",
  "insights_plays", "insights_fetched_at", "media_id",
];
const CONTAINER_NEW_COLUMNS = ["insights_plays_at", "published_at"];

/**
 * Reels publicados DESTA fila a partir de `sinceMs` (story não entra no
 * Raio-X). Loop: a busca é por created_at com margem e o corte fino por
 * publishedAt vem em memória.
 */
async function loadQueuePosts(
  admin: SupabaseClient,
  lim: Limiter,
  userId: string,
  source: QueueSource,
  queueId: string,
  sinceMs: number,
  accountById: Map<string, AccountDb>,
): Promise<PostRow[]> {
  if (source === "postar") {
    const rows = await fetchPagedWithNewColumns<ScheduledDb>(
      admin, lim, "scheduled_posts", SCHEDULED_COLUMNS, SCHEDULED_NEW_COLUMNS,
      (q) =>
        q.eq("user_id", userId)
          .eq("campaign_id", queueId)
          .eq("status", "published")
          .neq("post_type", "story")
          .not("published_at", "is", null)
          .gte("published_at", toIso(sinceMs)),
    );
    return rows.filter((r) => r.published_at).map((r) => fromScheduled(r, accountById));
  }

  const rows = await fetchPagedWithNewColumns<ContainerDb>(
    admin, lim, "pending_containers", CONTAINER_COLUMNS, CONTAINER_NEW_COLUMNS,
    (q) =>
      q.eq("user_id", userId)
        .eq("loop_id", queueId)
        .eq("status", "published")
        .not("media_id", "is", null)
        .gte("created_at", toIso(sinceMs - LOOP_CREATED_MARGIN_MS)),
  );
  return rows
    .filter((r) => r.media_id)
    .map((r) => fromContainer(r, accountById))
    .filter((p) => ms(p.publishedAt) >= sinceMs);
}

// ---------------------------------------------------------------------------
// Fila, contas, vídeos, histórico de uso
// ---------------------------------------------------------------------------

const CAMPAIGN_COLUMNS =
  "id, status, account_folder_ids, video_folder_id, video_count, posts_per_day, captions, " +
  "auto_caption_enabled, auto_caption_type, caption_mode, caption_strip_hashtags, caption_strip_mentions, " +
  "account_stagger_seconds, burst_mode, video_processing_mode, share_to_feed, use_proxy_pool, created_at";

const LOOP_COLUMNS =
  "id, name, status, folder_id, account_folder_id, is_infinite, cycles, media_limit, interval_minutes, " +
  "captions, auto_caption_enabled, auto_caption_type, caption_mode, caption_strip_hashtags, caption_strip_mentions, " +
  "account_stagger_seconds, video_processing_mode, share_to_feed, use_proxy_pool, created_at, " +
  "loop_accounts ( account_id )";

async function loadCampaignRow(admin: SupabaseClient, lim: Limiter, userId: string, id: string): Promise<CampaignDb | null> {
  const { data, error } = await lim.run(() =>
    admin.from("distribute_campaigns").select(CAMPAIGN_COLUMNS).eq("id", id).eq("user_id", userId).maybeSingle(),
  );
  if (error) throw new Error(`campanha: ${error.message}`);
  const row = data as unknown as CampaignDb | null;
  // 'preparing'/'failed' são campanhas que nunca chegaram a rodar — não são fila.
  if (!row || (row.status && row.status !== "active" && row.status !== "paused")) return null;
  return row;
}

async function loadLoopRow(admin: SupabaseClient, lim: Limiter, userId: string, id: string): Promise<LoopDb | null> {
  const { data, error } = await lim.run(() =>
    admin.from("loops").select(LOOP_COLUMNS).eq("id", id).eq("user_id", userId).maybeSingle(),
  );
  if (error) throw new Error(`loop: ${error.message}`);
  return (data as unknown as LoopDb | null) ?? null;
}

/** video_ids da campanha montada em modo fila ideal (coluna nova; sem ela, lista vazia). */
async function loadCampaignVideoIds(admin: SupabaseClient, lim: Limiter, userId: string, id: string): Promise<string[]> {
  const { data, error } = await lim.run(() =>
    admin.from("distribute_campaigns").select("video_ids").eq("id", id).eq("user_id", userId).maybeSingle(),
  );
  if (error) {
    if (!isMissingSchemaError(error)) console.warn(`[queue-insights] video_ids da campanha: ${error.message}`);
    return [];
  }
  const ids = (data as { video_ids?: string[] | null } | null)?.video_ids;
  return Array.isArray(ids) ? ids.filter((v) => typeof v === "string") : [];
}

async function loadUserAccounts(admin: SupabaseClient, lim: Limiter, userId: string): Promise<AccountDb[]> {
  return fetchPaged<AccountDb>(
    admin,
    lim,
    "instagram_accounts",
    "id, username, avatar_url, is_active, health_status, ig_business_account_id, folder_id",
    (q) => q.eq("user_id", userId),
  );
}

/**
 * Contas da campanha = contas com post nela (RPC agregado por conta — a
 * campanha pode ter milhares de linhas) + contas atuais das pastas
 * sincronizadas. `inflight` = posts pendentes/publicando.
 */
async function loadCampaignAccounts(
  admin: SupabaseClient,
  lim: Limiter,
  userId: string,
  campaign: CampaignDb,
  accounts: AccountDb[],
): Promise<{ accountIds: string[]; inflight: number }> {
  const fromPosts: string[] = [];
  let inflight = 0;

  if (accounts.length) {
    const { data, error } = await lim.run(() =>
      admin.rpc("get_distribute_account_states", {
        p_campaign_id: campaign.id,
        p_account_ids: accounts.map((a) => a.id),
      }),
    );
    if (!error) {
      type StateRow = { account_id: string; total_count: number | string; inflight_count: number | string };
      for (const r of (data ?? []) as StateRow[]) {
        if (Number(r.total_count) > 0) fromPosts.push(r.account_id);
        inflight += Number(r.inflight_count) || 0;
      }
    } else {
      // RPC indisponível: lê só conta e status das linhas da campanha.
      console.warn(`[queue-insights] get_distribute_account_states falhou (${error.message}) — lendo as linhas`);
      const rows = await fetchPaged<{ id: string; account_id: string; status: string }>(
        admin,
        lim,
        "scheduled_posts",
        "id, account_id, status",
        (q) => q.eq("campaign_id", campaign.id).eq("user_id", userId),
      );
      for (const r of rows) {
        fromPosts.push(r.account_id);
        if (r.status === "pending" || r.status === "publishing") inflight++;
      }
    }
  }

  const folders = new Set(campaign.account_folder_ids ?? []);
  const fromFolders = folders.size
    ? accounts.filter((a) => a.folder_id && folders.has(a.folder_id)).map((a) => a.id)
    : [];
  const owned = new Set(accounts.map((a) => a.id));
  return { accountIds: uniq([...fromPosts, ...fromFolders]).filter((id) => owned.has(id)), inflight };
}

const VIDEO_COLUMNS = "id, public_url, folder_id, source_url, created_at";

async function loadFolderVideos(admin: SupabaseClient, lim: Limiter, userId: string, folderId: string): Promise<VideoDb[]> {
  return fetchPaged<VideoDb>(admin, lim, "videos_library", VIDEO_COLUMNS, (q) =>
    q.eq("folder_id", folderId).eq("user_id", userId),
  );
}

async function loadFolderName(admin: SupabaseClient, lim: Limiter, userId: string, folderId: string): Promise<string | null> {
  const { data } = await lim.run(() =>
    admin.from("library_folders").select("name").eq("id", folderId).eq("user_id", userId).maybeSingle(),
  );
  return (data as { name?: string | null } | null)?.name ?? null;
}

/** Vídeos por id em blocos, com legenda (o painel mostra a dos vídeos da fila ideal). */
async function loadVideosById(admin: SupabaseClient, lim: Limiter, userId: string, ids: string[]): Promise<VideoDb[]> {
  if (!ids.length) return [];
  const parts = await Promise.all(
    chunk(ids, IN_CHUNK).map(async (part) => {
      const { data, error } = await lim.run(() =>
        admin.from("videos_library").select(`${VIDEO_COLUMNS}, caption`).eq("user_id", userId).in("id", part),
      );
      if (error) throw new Error(`vídeos: ${error.message}`);
      return (data ?? []) as unknown as VideoDb[];
    }),
  );
  return parts.flat();
}

// ---------------------------------------------------------------------------
// Raio-X de uma fila
// ---------------------------------------------------------------------------

export interface QueueInsightsLoad {
  input: AnalyzeInput;
  /** Tamanho do que foi lido — só para o log de tempo da rota. */
  stats: { requests: number; queuePosts: number; videos: number };
}

/**
 * Lê tudo que analyzeQueue precisa para uma fila do usuário. null = a fila
 * não existe ou não é dele (a rota responde 404).
 */
export async function loadQueueInsightsInput(
  admin: SupabaseClient,
  userId: string,
  source: QueueSource,
  id: string,
  now: Date,
): Promise<QueueInsightsLoad | null> {
  if (!UUID_RE.test(id)) return null;
  const lim = createLimiter(CONCURRENCY);
  const nowMs = now.getTime();

  // ── 1. Fila, contas do usuário e a lista fixa da campanha (modo fila ideal) ──
  const [campaign, loop, accounts, campaignVideoIds] = await Promise.all([
    source === "postar" ? loadCampaignRow(admin, lim, userId, id) : Promise.resolve(null),
    source === "loop" ? loadLoopRow(admin, lim, userId, id) : Promise.resolve(null),
    loadUserAccounts(admin, lim, userId),
    source === "postar" ? loadCampaignVideoIds(admin, lim, userId, id) : Promise.resolve([] as string[]),
  ]);
  if (source === "postar" ? !campaign : !loop) return null;
  const accountById = new Map(accounts.map((a) => [a.id, a]));

  // Começo da contagem: o início da fila, ou 30 dias atrás numa fila mais antiga.
  const createdMs = ms(campaign ? campaign.created_at : loop!.created_at);
  const floorMs = nowMs - QUEUE_POSTS_DAYS * D;
  const sinceMs = Number.isFinite(createdMs) ? Math.max(createdMs, floorMs) : floorMs;

  // ── 2. Posts da fila e vídeos da pasta já saem; as contas da campanha vêm do RPC ──
  const folderId = campaign ? campaign.video_folder_id : loop!.folder_id;
  const queuePostsP = started(loadQueuePosts(admin, lim, userId, source, id, sinceMs, accountById));
  const folderVideosP = started(folderId ? loadFolderVideos(admin, lim, userId, folderId) : Promise.resolve([] as VideoDb[]));
  const folderNameP = started(folderId ? loadFolderName(admin, lim, userId, folderId) : Promise.resolve(null));

  const { accountIds, inflight } = campaign
    ? await loadCampaignAccounts(admin, lim, userId, campaign, accounts)
    : { accountIds: loopAccountIds(loop!, accounts), inflight: 0 };


  const [queuePosts, folderVideos, folderName] = await Promise.all([queuePostsP, folderVideosP, folderNameP]);

  // ── 3. Vídeos citados (posts da fila + lista fixa da campanha), com legenda ──
  const referencedIds = uniq(
    [...queuePosts.map((p) => p.videoId), ...campaignVideoIds].filter((v): v is string => !!v),
  );
  const referenced = await loadVideosById(admin, lim, userId, referencedIds);
  const videoById = new Map<string, VideoDb>();
  for (const v of folderVideos) videoById.set(v.id, { ...v, caption: null });
  for (const v of referenced) videoById.set(v.id, v);

  // Mesmo Reel importado 2× na Biblioteca = um vídeo só (shortcode do source_url).
  const keyCache = new Map<string, string>();
  const videoKeyOf = (videoId: string): string => {
    let key = keyCache.get(videoId);
    if (key === undefined) {
      const sourceUrl = videoById.get(videoId)?.source_url;
      key = (sourceUrl ? shortCodeFromUrl(sourceUrl) : null) ?? videoId;
      keyCache.set(videoId, key);
    }
    return key;
  };
  for (const p of queuePosts) {
    p.videoKey = p.videoId ? videoKeyOf(p.videoId) : null;
  }

  // Mais recente primeiro: com o mesmo Reel importado 2× na pasta, a cópia
  // mais nova vem antes.
  const videos: VideoInfo[] = Array.from(videoById.values())
    .sort((a, b) => (ms(b.created_at) || 0) - (ms(a.created_at) || 0))
    .map((v) => ({
      id: v.id,
      publicUrl: v.public_url ?? null,
      caption: v.caption ?? null,
      folderId: v.folder_id ?? null,
      sourceUrl: v.source_url ?? null,
    }));

  // Campanha em modo fila ideal: a lista fixa É a "pasta" da fila — a pasta de
  // origem só serve para a linha da campanha. Medir pela pasta inteira deixaria
  // de fora da fila ideal os vídeos que o próprio painel escolheu.
  const fixedList = campaignVideoIds.filter((v) => videoById.has(v));
  const folderVideoIds = fixedList.length > 0 ? uniq(fixedList) : uniq(folderVideos.map((v) => v.id));

  // ── 4. Config da fila ──
  const lastPublishedAt = queuePosts.reduce<string | null>(
    (acc, p) => (!acc || ms(p.publishedAt) > ms(acc) ? p.publishedAt : acc),
    null,
  );
  const publishedLast24h = queuePosts.filter((p) => nowMs - ms(p.publishedAt) <= D).length;
  const folderCount = folderVideoIds.length;

  let queue: QueueConfig;
  if (campaign) {
    const videoCount = campaign.video_count ?? -1;
    const burst = campaign.burst_mode === true;
    queue = {
      source,
      id,
      label: postarLabel(folderName, accountIds.length, campaign.created_at),
      state: campaignState(campaign, inflight, lastPublishedAt, nowMs),
      accountCount: accountIds.length,
      intervalMinutes: campaignInterval(campaign),
      burstMode: burst,
      publishedLast24h,
      createdAt: toIso(campaign.created_at),
      folderId,
      folderName,
      folderVideoIds,
      accountIds,
      // Mesmo corte do distribute: -1 = pasta inteira; senão video_count, limitado ao que a pasta tem.
      videoCountCap: videoCount < 0 ? folderCount : folderCount > 0 ? Math.min(videoCount, folderCount) : videoCount,
      postsPerDay: burst ? null : Math.max(1, campaign.posts_per_day ?? 1),
      handoff: handoffDefaults(campaign, folderId),
    };
  } else {
    const l = loop!;
    const interval = Math.max(1, l.interval_minutes ?? 10);
    // Finito: cada conta para em min(cycles, media_limit) posts (process-loops).
    const cap = l.is_infinite === false
      ? Math.min(l.cycles ?? Infinity, l.media_limit ?? Infinity, folderCount)
      : folderCount;
    queue = {
      source,
      id,
      label: loopLabel(l.name),
      state: loopState(l.status),
      accountCount: accountIds.length,
      intervalMinutes: interval,
      burstMode: false,
      publishedLast24h,
      createdAt: toIso(l.created_at),
      folderId,
      folderName,
      folderVideoIds,
      accountIds,
      videoCountCap: Math.max(0, Math.floor(cap)),
      postsPerDay: Math.round(1440 / interval),
      handoff: handoffDefaults(l, folderId),
    };
  }

  // ── 5. Contas citadas (as da fila + as que postaram nela) ──
  const infoIds = uniq([...accountIds, ...queuePosts.map((p) => p.accountId)]);
  const accountInfos: AccountInfo[] = infoIds
    .map((accId) => accountById.get(accId))
    .filter((a): a is AccountDb => !!a)
    .map((a) => ({
      id: a.id,
      username: a.username ?? "?",
      avatarUrl: a.avatar_url ?? null,
      isActive: a.is_active !== false,
      healthStatus: a.health_status ?? null,
      igAccountKey: a.ig_business_account_id || a.id,
    }));

  return {
    input: {
      queue,
      queuePosts,
      accounts: accountInfos,
      videos,
    },
    stats: {
      requests: lim.requests,
      queuePosts: queuePosts.length,
      videos: videos.length,
    },
  };
}

// ---------------------------------------------------------------------------
// Seletor de filas
// ---------------------------------------------------------------------------

interface CampaignListDb {
  id: string;
  status: string | null;
  account_folder_ids: string[] | null;
  video_folder_id: string | null;
  posts_per_day: number | null;
  burst_mode: boolean | null;
  created_at: string;
}

interface LoopListDb {
  id: string;
  name: string | null;
  status: string | null;
  interval_minutes: number | null;
  account_folder_id: string | null;
  created_at: string;
  last_posted_at: string | null;
  loop_accounts: { account_id: string }[] | null;
}

interface CampaignStats {
  inflight: number;
  lastPublishedAt: string | null;
  accountIds: string[];
}

/**
 * Pendentes, última publicação e contas de cada campanha. O RPC de resumo
 * agrega tudo numa chamada (é o mesmo da tela de Campanhas); sem ele, uma
 * leitura por campanha.
 */
async function loadCampaignStats(
  admin: SupabaseClient,
  lim: Limiter,
  userId: string,
  campaigns: CampaignListDb[],
): Promise<Map<string, CampaignStats>> {
  const stats = new Map<string, CampaignStats>();
  const { data, error } = await lim.run(() => admin.rpc("get_campaign_summaries", { p_user_id: userId }));
  if (!error) {
    type SummaryRow = {
      campaign_id: string;
      pending: number | string | null;
      last_published_at: string | null;
      account_ids: string[] | null;
    };
    for (const r of (data ?? []) as SummaryRow[]) {
      stats.set(r.campaign_id, {
        inflight: Number(r.pending) || 0,
        lastPublishedAt: r.last_published_at ?? null,
        accountIds: r.account_ids ?? [],
      });
    }
    return stats;
  }

  console.warn(`[queue-insights] get_campaign_summaries falhou (${error.message}) — lendo campanha por campanha`);
  const accounts = await fetchPaged<{ id: string }>(admin, lim, "instagram_accounts", "id", (q) => q.eq("user_id", userId));
  const accountIds = accounts.map((a) => a.id);
  await Promise.all(
    campaigns.map(async (c) => {
      const [statesRes, lastRes] = await Promise.all([
        accountIds.length
          ? lim.run(() =>
              admin.rpc("get_distribute_account_states", { p_campaign_id: c.id, p_account_ids: accountIds }),
            )
          : Promise.resolve({ data: [], error: null }),
        lim.run(() =>
          admin
            .from("scheduled_posts")
            .select("published_at")
            .eq("campaign_id", c.id)
            .eq("user_id", userId)
            .eq("status", "published")
            .not("published_at", "is", null)
            .order("published_at", { ascending: false })
            .limit(1),
        ),
      ]);
      type StateRow = { account_id: string; total_count: number | string; inflight_count: number | string };
      const states = (statesRes.error ? [] : (statesRes.data ?? [])) as StateRow[];
      const last = ((lastRes.data ?? []) as { published_at: string | null }[])[0]?.published_at ?? null;
      stats.set(c.id, {
        inflight: states.reduce((s, r) => s + (Number(r.inflight_count) || 0), 0),
        lastPublishedAt: last,
        accountIds: states.filter((r) => Number(r.total_count) > 0).map((r) => r.account_id),
      });
    }),
  );
  return stats;
}

/** Campanhas de Automatizar usam campaign_id = automation.id — ficam fora do seletor. */
async function loadAutomationIds(admin: SupabaseClient, lim: Limiter, userId: string): Promise<Set<string>> {
  const { data, error } = await lim.run(() => admin.from("automations").select("id").eq("user_id", userId));
  if (error) return new Set();
  return new Set(((data ?? []) as { id: string }[]).map((r) => r.id));
}

async function countPublishedSince(
  admin: SupabaseClient,
  lim: Limiter,
  userId: string,
  source: QueueSource,
  id: string,
  sinceMs: number,
): Promise<number> {
  // Loop: por created_at (published_at pode nem existir ainda) — o container
  // publica minutos depois de criado, erro desprezível para a contagem.
  const res = await lim.run(() =>
    source === "postar"
      ? admin
          .from("scheduled_posts")
          .select("id", { count: "exact", head: true })
          .eq("campaign_id", id)
          .eq("user_id", userId)
          .eq("status", "published")
          .neq("post_type", "story")
          .gte("published_at", toIso(sinceMs))
      : admin
          .from("pending_containers")
          .select("id", { count: "exact", head: true })
          .eq("loop_id", id)
          .eq("user_id", userId)
          .eq("status", "published")
          .not("media_id", "is", null)
          .gte("created_at", toIso(sinceMs)),
  );
  if (res.error) {
    console.warn(`[queue-insights] contagem de ${source}/${id.slice(0, 8)} falhou: ${res.error.message}`);
    return 0;
  }
  return res.count ?? 0;
}

const STATE_ORDER: Record<QueueState, number> = { running: 0, running_synced: 0, paused: 1, finished: 2 };

/**
 * Filas do seletor: só as que estão rodando agora (campanhas ativas do Postar
 * e Loops ativos). Sem nenhuma rodando, entra só a última fila (a de publicação
 * mais recente), mesmo terminada. Campanhas vêm antes dos Loops; abre na com
 * mais posts nas últimas 24h.
 */
export async function loadQueueList(admin: SupabaseClient, userId: string, now: Date): Promise<QueueListResponse> {
  const lim = createLimiter(CONCURRENCY);
  const nowMs = now.getTime();

  // ── 1. Campanhas, Loops e o resumo agregado das campanhas ──
  const [campaignRows, automationIds, loopsRes] = await Promise.all([
    fetchPaged<CampaignListDb>(
      admin,
      lim,
      "distribute_campaigns",
      "id, status, account_folder_ids, video_folder_id, posts_per_day, burst_mode, created_at",
      (q) => q.eq("user_id", userId),
    ),
    loadAutomationIds(admin, lim, userId),
    lim.run(() =>
      admin
        .from("loops")
        .select("id, name, status, interval_minutes, account_folder_id, created_at, last_posted_at, loop_accounts ( account_id )")
        .eq("user_id", userId),
    ),
  ]);
  if (loopsRes.error) throw new Error(`loops: ${loopsRes.error.message}`);

  // Só o Postar cria linha em distribute_campaigns; 'preparing'/'failed' nunca rodaram.
  const campaigns = campaignRows.filter(
    (c) => !automationIds.has(c.id) && (!c.status || c.status === "active" || c.status === "paused"),
  );
  const loops = (loopsRes.data ?? []) as unknown as LoopListDb[];
  const campaignStats = campaigns.length
    ? await loadCampaignStats(admin, lim, userId, campaigns)
    : new Map<string, CampaignStats>();

  // ── 2. Quem entra: só fila rodando; sem nenhuma, a última fila ──
  const campaignEntries = campaigns.map((c) => {
    const s = campaignStats.get(c.id) ?? { inflight: 0, lastPublishedAt: null, accountIds: [] };
    return { row: c, stats: s, state: campaignState(c, s.inflight, s.lastPublishedAt, nowMs) };
  });
  const loopEntries = loops.map((l) => ({ row: l, state: loopState(l.status) }));

  let listedCampaigns = campaignEntries.filter(({ state }) => isRunning(state));
  let listedLoops = loopEntries.filter(({ state }) => isRunning(state));

  // Nada rodando: entra só a última fila, mesmo terminada — a fila acabou antes
  // de o dono montar a fila ideal dela, e o Raio-X ainda mostra os vídeos.
  if (!listedCampaigns.length && !listedLoops.length) {
    const lastCampaign = latestBy(campaignEntries, (e) => e.stats.lastPublishedAt);
    const lastLoop = latestBy(loopEntries, (e) => e.row.last_posted_at);
    if (lastCampaign && (!lastLoop || lastCampaign.at >= lastLoop.at)) listedCampaigns = [lastCampaign.item];
    else if (lastLoop) listedLoops = [lastLoop.item];
  }

  // ── 3. Nomes de pasta, contas das pastas e contagens 24h ──
  const videoFolderIds = uniq(listedCampaigns.map((c) => c.row.video_folder_id).filter((v): v is string => !!v));
  const accountFolderIds = uniq([
    ...listedCampaigns.flatMap((c) => c.row.account_folder_ids ?? []),
    ...listedLoops.map((l) => l.row.account_folder_id).filter((v): v is string => !!v),
  ]);

  const [folderNames, folderAccounts, campaign24h, loop24h] = await Promise.all([
    videoFolderIds.length
      ? lim.run(() => admin.from("library_folders").select("id, name").eq("user_id", userId).in("id", videoFolderIds))
      : Promise.resolve({ data: [], error: null }),
    accountFolderIds.length
      ? fetchPaged<{ id: string; folder_id: string | null }>(admin, lim, "instagram_accounts", "id, folder_id", (q) =>
          q.eq("user_id", userId).in("folder_id", accountFolderIds),
        )
      : Promise.resolve([] as { id: string; folder_id: string | null }[]),
    Promise.all(listedCampaigns.map((c) => countPublishedSince(admin, lim, userId, "postar", c.row.id, nowMs - D))),
    Promise.all(listedLoops.map((l) => countPublishedSince(admin, lim, userId, "loop", l.row.id, nowMs - D))),
  ]);

  const folderNameById = new Map(
    ((folderNames.data ?? []) as { id: string; name: string | null }[]).map((f) => [f.id, f.name ?? null]),
  );
  const accountsByFolder = new Map<string, string[]>();
  for (const a of folderAccounts) {
    if (!a.folder_id) continue;
    const list = accountsByFolder.get(a.folder_id) ?? [];
    list.push(a.id);
    accountsByFolder.set(a.folder_id, list);
  }

  const queues: QueueListItem[] = [];
  listedCampaigns.forEach(({ row, stats, state }, i) => {
    const accountIds = new Set(stats.accountIds);
    for (const folder of row.account_folder_ids ?? []) {
      for (const accId of accountsByFolder.get(folder) ?? []) accountIds.add(accId);
    }
    queues.push({
      source: "postar",
      id: row.id,
      label: postarLabel(row.video_folder_id ? (folderNameById.get(row.video_folder_id) ?? null) : null, accountIds.size, row.created_at),
      state,
      accountCount: accountIds.size,
      intervalMinutes: campaignInterval(row),
      burstMode: row.burst_mode === true,
      publishedLast24h: campaign24h[i],
      createdAt: toIso(row.created_at),
    });
  });
  listedLoops.forEach(({ row, state }, i) => {
    const accountCount = row.account_folder_id
      ? (accountsByFolder.get(row.account_folder_id) ?? []).length
      : uniq((row.loop_accounts ?? []).map((la) => la.account_id)).length;
    queues.push({
      source: "loop",
      id: row.id,
      label: loopLabel(row.name),
      state,
      accountCount,
      intervalMinutes: Math.max(1, row.interval_minutes ?? 10),
      burstMode: false,
      publishedLast24h: loop24h[i],
      createdAt: toIso(row.created_at),
    });
  });

  queues.sort(
    (a, b) =>
      STATE_ORDER[a.state] - STATE_ORDER[b.state] ||
      (a.source === b.source ? 0 : a.source === "postar" ? -1 : 1) ||
      b.publishedLast24h - a.publishedLast24h ||
      ms(b.createdAt) - ms(a.createdAt),
  );

  // A ordenação já põe a campanha com mais posts em 24h na frente.
  const first = queues[0];
  const defaultQueue = first ? { source: first.source, id: first.id } : null;

  return { queues, defaultQueue };
}
