/**
 * Aba Fila — leitura do banco. Regras em docs/fila-pausa.md.
 *
 * As filas rodando vêm do mesmo seletor do Raio-X (loadQueueList: campanhas
 * ativas do Postar e Loops ativos); a aba agrupa essas filas pela pasta de
 * vídeos. Os números de cada vídeo somam os reels publicados por todas as filas
 * rodando da pasta, desde o começo de cada uma (até 30 dias, a mesma janela do
 * Raio-X). Só lê.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  UUID_RE,
  createLimiter,
  fetchPaged,
  isMissingSchemaError,
  loadQueueList,
  type Limiter,
} from "@/lib/queue-insights/load";
import type { QueueListItem } from "@/lib/queue-insights/types";
import {
  buildAccountQueues,
  type AccountQueuesResponse,
  type QueueAccount,
  type QueueCampaign,
  type QueueLoop,
} from "./account-queues";
import { aggregateFila, type FilaPost, type FilaVideoInput } from "./stats";
import type { FilaFolder, FilaFolderResponse, FilaListResponse, FilaQueue } from "./types";

const D = 24 * 60 * 60_000;
/** Mesma janela do Raio-X (QUEUE_POSTS_DAYS): posts desde o começo da fila, até 30 dias. */
const POSTS_DAYS = 30;
const CONCURRENCY = 6;

/** A tela só mostra a 1ª linha da legenda: o resto (até 2.200 caracteres por vídeo) não viaja. */
const CAPTION_PREVIEW_CHARS = 200;

function captionPreview(caption: string | null | undefined): string | null {
  const line = caption?.split("\n").map((l) => l.trim()).find(Boolean);
  return line ? line.slice(0, CAPTION_PREVIEW_CHARS) : null;
}

function toFilaQueue(q: QueueListItem): FilaQueue {
  return {
    source: q.source,
    id: q.id,
    label: q.label,
    accountCount: q.accountCount,
    publishedLast24h: q.publishedLast24h,
    createdAt: q.createdAt,
  };
}

/** Pasta de vídeos de cada fila rodando (`source:id` → folder_id). Fila sem pasta fica de fora. */
async function loadQueueFolderIds(
  admin: SupabaseClient,
  lim: Limiter,
  userId: string,
  queues: QueueListItem[],
): Promise<Map<string, string>> {
  const campaignIds = queues.filter((q) => q.source === "postar").map((q) => q.id);
  const loopIds = queues.filter((q) => q.source === "loop").map((q) => q.id);
  const [campaigns, loops] = await Promise.all([
    campaignIds.length
      ? lim.run(() =>
          admin.from("distribute_campaigns").select("id, video_folder_id").eq("user_id", userId).in("id", campaignIds),
        )
      : Promise.resolve({ data: [], error: null }),
    loopIds.length
      ? lim.run(() => admin.from("loops").select("id, folder_id").eq("user_id", userId).in("id", loopIds))
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (campaigns.error) throw new Error(`pastas das campanhas: ${campaigns.error.message}`);
  if (loops.error) throw new Error(`pastas dos loops: ${loops.error.message}`);

  const out = new Map<string, string>();
  for (const c of (campaigns.data ?? []) as { id: string; video_folder_id: string | null }[]) {
    if (c.video_folder_id) out.set(`postar:${c.id}`, c.video_folder_id);
  }
  for (const l of (loops.data ?? []) as { id: string; folder_id: string | null }[]) {
    if (l.folder_id) out.set(`loop:${l.id}`, l.folder_id);
  }
  return out;
}

/** Filas rodando agrupadas pela pasta, na ordem do seletor do Raio-X (a mais movimentada primeiro). */
async function runningQueuesByFolder(
  admin: SupabaseClient,
  lim: Limiter,
  userId: string,
  now: Date,
): Promise<Map<string, QueueListItem[]>> {
  const { queues } = await loadQueueList(admin, userId, now);
  const byFolder = new Map<string, QueueListItem[]>();
  if (!queues.length) return byFolder;
  const folderOf = await loadQueueFolderIds(admin, lim, userId, queues);
  for (const q of queues) {
    const folderId = folderOf.get(`${q.source}:${q.id}`);
    if (!folderId) continue;
    const list = byFolder.get(folderId) ?? [];
    list.push(q);
    byFolder.set(folderId, list);
  }
  return byFolder;
}

/** Seletor da aba: só pastas com fila rodando. */
export async function loadFilaList(admin: SupabaseClient, userId: string, now: Date): Promise<FilaListResponse> {
  const lim = createLimiter(CONCURRENCY);
  const byFolder = await runningQueuesByFolder(admin, lim, userId, now);
  const folderIds = Array.from(byFolder.keys());
  if (!folderIds.length) return { folders: [], defaultFolderId: null };

  const [names, counts] = await Promise.all([
    lim.run(() => admin.from("library_folders").select("id, name").eq("user_id", userId).in("id", folderIds)),
    Promise.all(
      folderIds.map((id) =>
        lim.run(() =>
          admin
            .from("videos_library")
            .select("id", { count: "exact", head: true })
            .eq("user_id", userId)
            .eq("folder_id", id),
        ),
      ),
    ),
  ]);
  if (names.error) throw new Error(`pastas: ${names.error.message}`);
  const nameById = new Map(((names.data ?? []) as { id: string; name: string | null }[]).map((f) => [f.id, f.name]));

  const folders: FilaFolder[] = [];
  folderIds.forEach((id, i) => {
    // Pasta de outro usuário ou apagada no meio: fica de fora.
    if (!nameById.has(id)) return;
    folders.push({
      id,
      name: nameById.get(id)?.trim() || "Sem nome",
      videoCount: counts[i].count ?? 0,
      queues: (byFolder.get(id) ?? []).map(toFilaQueue),
    });
  });

  return { folders, defaultFolderId: folders[0]?.id ?? null };
}

interface VideoDb {
  id: string;
  public_url: string | null;
  caption: string | null;
  created_at: string | null;
  queue_paused_at?: string | null;
}

/** A coluna da pausa existe? (SQL manual supabase/fila_pausa_videos.sql) */
async function hasPauseColumn(admin: SupabaseClient, lim: Limiter): Promise<boolean> {
  const { error } = await lim.run(() => admin.from("videos_library").select("queue_paused_at").limit(1));
  if (!error) return true;
  if (isMissingSchemaError(error)) return false;
  throw new Error(`coluna da pausa: ${error.message}`);
}

/** Reels publicados por uma fila desde `sinceMs` — só vídeo e views. */
async function loadQueuePosts(
  admin: SupabaseClient,
  lim: Limiter,
  userId: string,
  queue: QueueListItem,
  sinceMs: number,
): Promise<FilaPost[]> {
  const since = new Date(sinceMs).toISOString();
  const rows =
    queue.source === "postar"
      ? await fetchPaged<{ id: string; video_id: string | null; insights_plays: number | null }>(
          admin, lim, "scheduled_posts", "id, video_id, insights_plays",
          (q) =>
            q.eq("user_id", userId)
              .eq("campaign_id", queue.id)
              .eq("status", "published")
              .neq("post_type", "story")
              .not("published_at", "is", null)
              .gte("published_at", since),
        )
      : // Loop: por created_at (published_at é nulo nas linhas antigas) — o
        // container publica minutos depois de criado.
        await fetchPaged<{ id: string; video_id: string | null; insights_plays: number | null }>(
          admin, lim, "pending_containers", "id, video_id, insights_plays",
          (q) =>
            q.eq("user_id", userId)
              .eq("loop_id", queue.id)
              .eq("status", "published")
              .not("media_id", "is", null)
              .gte("created_at", since),
        );
  return rows.map((r) => ({ videoId: r.video_id ?? null, views: r.insights_plays ?? null }));
}

/**
 * Vídeos de uma pasta do usuário com os números nas filas rodando dela.
 * null = a pasta não existe ou não é dele (a rota responde 404).
 */
export async function loadFilaFolder(
  admin: SupabaseClient,
  userId: string,
  folderId: string,
  now: Date,
): Promise<FilaFolderResponse | null> {
  if (!UUID_RE.test(folderId)) return null;
  const lim = createLimiter(CONCURRENCY);

  const [folderRes, byFolder, pauseAvailable] = await Promise.all([
    lim.run(() => admin.from("library_folders").select("id, name").eq("id", folderId).eq("user_id", userId).maybeSingle()),
    runningQueuesByFolder(admin, lim, userId, now),
    hasPauseColumn(admin, lim),
  ]);
  if (folderRes.error) throw new Error(`pasta: ${folderRes.error.message}`);
  const folder = folderRes.data as { id: string; name: string | null } | null;
  if (!folder) return null;

  const queues = byFolder.get(folderId) ?? [];
  const floorMs = now.getTime() - POSTS_DAYS * D;
  const sinceOf = (q: QueueListItem) => {
    const created = Date.parse(q.createdAt);
    return Number.isFinite(created) ? Math.max(created, floorMs) : floorMs;
  };

  const columns = `id, public_url, caption, created_at${pauseAvailable ? ", queue_paused_at" : ""}`;
  const [videos, postsPerQueue] = await Promise.all([
    fetchPaged<VideoDb>(admin, lim, "videos_library", columns, (q) => q.eq("folder_id", folderId).eq("user_id", userId)),
    Promise.all(queues.map((q) => loadQueuePosts(admin, lim, userId, q, sinceOf(q)))),
  ]);

  const inputs: FilaVideoInput[] = videos.map((v) => ({
    id: v.id,
    publicUrl: v.public_url ?? null,
    caption: captionPreview(v.caption),
    createdAt: v.created_at ?? null,
    pausedAt: v.queue_paused_at ?? null,
  }));
  const { videos: rows, summary } = aggregateFila(inputs, postsPerQueue.flat());

  const countingSince = queues.length
    ? new Date(Math.min(...queues.map(sinceOf))).toISOString()
    : null;

  return {
    folder: { id: folder.id, name: folder.name?.trim() || "Sem nome" },
    queues: queues.map(toFilaQueue),
    countingSince,
    summary,
    videos: rows,
    pauseAvailable,
  };
}

// ---------------------------------------------------------------------------
// Contas em fila — o verde dos seletores de contas do Postar e do Loop
// ---------------------------------------------------------------------------

interface QueueAccountDb {
  id: string;
  folder_id: string | null;
  is_active: boolean | null;
  health_status: string | null;
}

interface QueueCampaignDb {
  id: string;
  status: string | null;
  account_folder_ids: string[] | null;
  video_folder_id: string | null;
  video_count: number | null;
  burst_mode: boolean | null;
}

interface QueueLoopDb {
  id: string;
  name: string | null;
  status: string | null;
  account_folder_id: string | null;
  loop_accounts: { account_id: string }[] | null;
}

interface AccountStateDb {
  account_id: string;
  total_count: number | string;
  inflight_count: number | string;
}

type CampaignStates = Map<string, { total: number; inflight: number }>;

/** Posts de cada conta na campanha (total e em voo): o RPC do sync; sem ele, só as linhas em voo. */
async function loadCampaignStates(
  admin: SupabaseClient,
  lim: Limiter,
  userId: string,
  campaignId: string,
  accountIds: string[],
): Promise<CampaignStates> {
  const out: CampaignStates = new Map();
  const { data, error } = await lim.run(() =>
    admin.rpc("get_distribute_account_states", { p_campaign_id: campaignId, p_account_ids: accountIds }),
  );
  if (!error) {
    for (const r of (data ?? []) as AccountStateDb[]) {
      out.set(r.account_id, { total: Number(r.total_count) || 0, inflight: Number(r.inflight_count) || 0 });
    }
    return out;
  }
  console.warn(`[fila] get_distribute_account_states falhou (${error.message}) — lendo os posts em voo`);
  const rows = await fetchPaged<{ id: string; account_id: string }>(admin, lim, "scheduled_posts", "id, account_id", (q) =>
    q.eq("user_id", userId).eq("campaign_id", campaignId).in("status", ["pending", "publishing"]),
  );
  for (const r of rows) {
    const s = out.get(r.account_id) ?? { total: 0, inflight: 0 };
    s.total++;
    s.inflight++;
    out.set(r.account_id, s);
  }
  return out;
}

/** Contas do usuário que já estão numa fila do Postar ou Loop ativa ou pausada (regra em ./account-queues). */
export async function loadAccountQueues(admin: SupabaseClient, userId: string): Promise<AccountQueuesResponse> {
  const lim = createLimiter(CONCURRENCY);
  const [accounts, campaignsRes, loopsRes] = await Promise.all([
    fetchPaged<QueueAccountDb>(admin, lim, "instagram_accounts", "id, folder_id, is_active, health_status", (q) =>
      q.eq("user_id", userId),
    ),
    lim.run(() =>
      admin
        .from("distribute_campaigns")
        .select("id, status, account_folder_ids, video_folder_id, video_count, burst_mode")
        .eq("user_id", userId)
        .in("status", ["active", "paused"]),
    ),
    lim.run(() =>
      admin
        .from("loops")
        .select("id, name, status, account_folder_id, loop_accounts ( account_id )")
        .eq("user_id", userId)
        .in("status", ["active", "paused"]),
    ),
  ]);
  if (campaignsRes.error) throw new Error(`campanhas: ${campaignsRes.error.message}`);
  if (loopsRes.error) throw new Error(`loops: ${loopsRes.error.message}`);
  const campaignRows = (campaignsRes.data ?? []) as QueueCampaignDb[];
  const loopRows = (loopsRes.data ?? []) as unknown as QueueLoopDb[];
  if (!accounts.length || (!campaignRows.length && !loopRows.length)) return { accounts: {} };

  const accountIds = accounts.map((a) => a.id);
  const isSynced = (c: QueueCampaignDb) => (c.account_folder_ids ?? []).length > 0 && c.burst_mode !== true;
  const videoFolderIds = Array.from(
    new Set(campaignRows.map((c) => c.video_folder_id).filter((v): v is string => !!v)),
  );

  const [namesRes, folderCounts, states] = await Promise.all([
    videoFolderIds.length
      ? lim.run(() => admin.from("library_folders").select("id, name").eq("user_id", userId).in("id", videoFolderIds))
      : Promise.resolve({ data: [], error: null }),
    // Teto da sincronizada = o do cron: vídeos da pasta (pausados inclusos), ou video_count.
    Promise.all(
      campaignRows.map((c) =>
        isSynced(c) && c.video_folder_id
          ? lim.run(() =>
              admin
                .from("videos_library")
                .select("id", { count: "exact", head: true })
                .eq("user_id", userId)
                .eq("folder_id", c.video_folder_id!),
            )
          : Promise.resolve(null),
      ),
    ),
    Promise.all(campaignRows.map((c) => loadCampaignStates(admin, lim, userId, c.id, accountIds))),
  ]);
  const nameById = new Map(
    ((namesRes.data ?? []) as { id: string; name: string | null }[]).map((f) => [f.id, f.name?.trim() || "sem nome"]),
  );

  const campaigns: QueueCampaign[] = campaignRows.map((c, i) => {
    const folderCount = folderCounts[i]?.count ?? null;
    const videoCount = c.video_count ?? -1;
    const folderName = c.video_folder_id ? (nameById.get(c.video_folder_id) ?? "apagada") : "apagada";
    return {
      id: c.id,
      label: `Postar · pasta ${folderName}${c.status === "paused" ? " (pausada)" : ""}`,
      accountFolderIds: c.account_folder_ids ?? [],
      burstMode: c.burst_mode === true,
      maxVideos: folderCount == null ? null : videoCount < 0 ? folderCount : Math.min(videoCount, folderCount),
      states: states[i],
    };
  });
  const loops: QueueLoop[] = loopRows.map((l) => ({
    id: l.id,
    label: `Loop · ${l.name?.trim() || "Meu Loop"}${l.status === "paused" ? " (pausado)" : ""}`,
    accountFolderId: l.account_folder_id,
    accountIds: (l.loop_accounts ?? []).map((la) => la.account_id),
  }));
  const queueAccounts: QueueAccount[] = accounts.map((a) => ({
    id: a.id,
    folderId: a.folder_id,
    isActive: a.is_active,
    healthStatus: a.health_status,
  }));

  return { accounts: buildAccountQueues(queueAccounts, campaigns, loops) };
}
