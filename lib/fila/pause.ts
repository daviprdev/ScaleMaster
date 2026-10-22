/**
 * Aba Fila — vídeo pausado (videos_library.queue_paused_at, SQL manual
 * supabase/fila_pausa_videos.sql). Regras em docs/fila-pausa.md.
 *
 * Pausado = fora da fila até ser reativado:
 *  - Postar: campanha nova e conta que entra pela pasta sincronizada não
 *    sorteiam o vídeo (posts/distribute, sync-distribute-accounts);
 *  - Loop: o vídeo sai do sorteio da pasta (process-loops);
 *  - post já agendado com ele, ao vencer, troca de vídeo com um post pendente
 *    posterior da mesma conta na campanha (deferPausedPosts, no
 *    publish-scheduled) — a conta mantém o ritmo e o vídeo pausado vai para o
 *    fim da fila dela; sem post para trocar, é cancelado.
 *
 * Tudo fail-open: sem a coluna (SQL pendente) ou com erro de leitura, nada é
 * pausado e a publicação segue como antes da aba existir.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { isMissingSchemaError } from "@/lib/queue-insights/load";
import { pickSwapTarget } from "./stats";

export const PAUSE_SQL_FILE = "supabase/fila_pausa_videos.sql";

/** Motivo do post cancelado por vídeo pausado (aparece onde o post é listado). */
export const PAUSED_VIDEO_CANCEL_MSG = "Vídeo pausado na aba Fila — post não enviado.";

const PAGE = 1000;
/** Tamanho dos `.in()` — 150 uuids cabem folgado na URL. */
const IN_CHUNK = 150;
/** Posts vencidos tratados por rodada do publish-scheduled (no normal, 0–2). */
const DEFER_MAX_PER_RUN = 40;
/** Posts posteriores da conta olhados para a troca (do mais distante para o mais próximo). */
const SWAP_LOOKAHEAD = 50;
/** Janela do "mesmo vídeo saindo em outra conta da campanha na mesma hora". */
const BUSY_WINDOW_MS = 60 * 60_000;

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

// Sem a coluna, lembra por 5 min: o publish-scheduled roda todo minuto e não
// precisa errar a leitura nem encher o log a cada rodada até o SQL entrar.
let columnMissingAt: number | null = null;
const MISSING_RETRY_MS = 5 * 60_000;

/**
 * Vídeos pausados na aba Fila. `userId`/`folderId` restringem; o cron global
 * não passa nada. Fail-open: sem a coluna ou com erro, conjunto vazio.
 */
export async function fetchPausedVideoIds(
  admin: SupabaseClient,
  scope: { userId?: string | null; folderId?: string | null } = {},
): Promise<Set<string>> {
  const ids = new Set<string>();
  if (columnMissingAt !== null && Date.now() - columnMissingAt < MISSING_RETRY_MS) return ids;
  try {
    for (let from = 0; ; from += PAGE) {
      let q = admin.from("videos_library").select("id").not("queue_paused_at", "is", null);
      if (scope.userId) q = q.eq("user_id", scope.userId);
      if (scope.folderId) q = q.eq("folder_id", scope.folderId);
      const { data, error } = await q.order("id", { ascending: true }).range(from, from + PAGE - 1);
      if (error) {
        if (isMissingSchemaError(error)) {
          columnMissingAt = Date.now();
          console.warn(`[fila] videos_library.queue_paused_at ausente (falta ${PAUSE_SQL_FILE}) — nenhum vídeo pausado.`);
        } else {
          console.warn(`[fila] leitura dos vídeos pausados falhou (segue sem pausa): ${error.message}`);
        }
        return new Set();
      }
      const rows = (data ?? []) as { id: string }[];
      for (const r of rows) ids.add(r.id);
      if (rows.length < PAGE) break;
    }
  } catch (e) {
    console.warn(`[fila] leitura dos vídeos pausados falhou (segue sem pausa): ${(e as Error).message}`);
    return new Set();
  }
  columnMissingAt = null;
  return ids;
}

// ---------------------------------------------------------------------------
// Post vencido de vídeo pausado (publish-scheduled)
// ---------------------------------------------------------------------------

interface DuePausedPost {
  id: string;
  account_id: string;
  campaign_id: string;
  video_id: string;
  video_url: string | null;
  caption: string | null;
  scheduled_at: string;
}

interface LaterPost {
  id: string;
  video_id: string | null;
  video_url: string | null;
  caption: string | null;
}

export interface DeferPausedResult {
  swapped: number;
  cancelled: number;
}

/**
 * Post vencido de vídeo pausado (reel de campanha ativa do Postar) cede a vez:
 * troca vídeo, link e legenda com um post pendente posterior da mesma conta na
 * campanha (pickSwapTarget). A conta mantém o ritmo e o vídeo pausado vai para
 * o fim da fila dela — reativado antes disso, sai lá. Sem post para trocar, é
 * cancelado com o motivo. O publish-scheduled chama antes de buscar o lote.
 */
export async function deferPausedPosts(admin: SupabaseClient, nowIso: string): Promise<DeferPausedResult> {
  const result: DeferPausedResult = { swapped: 0, cancelled: 0 };
  const paused = await fetchPausedVideoIds(admin);
  if (!paused.size) return result;

  const due: DuePausedPost[] = [];
  for (const part of chunk([...paused], IN_CHUNK)) {
    const { data, error } = await admin
      .from("scheduled_posts")
      .select("id, account_id, campaign_id, video_id, video_url, caption, scheduled_at")
      .eq("status", "pending")
      .neq("post_type", "story")
      .lte("scheduled_at", nowIso)
      .not("campaign_id", "is", null)
      .in("video_id", part)
      .order("scheduled_at", { ascending: true })
      .limit(DEFER_MAX_PER_RUN);
    if (error) {
      console.warn(`[fila] busca de posts com vídeo pausado falhou (segue sem trocar): ${error.message}`);
      return result;
    }
    due.push(...((data ?? []) as DuePausedPost[]));
  }
  if (!due.length) return result;

  // Só filas do Postar rodando: campanha pausada fica como está (retomar
  // desloca os horários) e Agendar/Clone/Automatizar não são fila da aba.
  const { data: campaigns, error: campErr } = await admin
    .from("distribute_campaigns")
    .select("id")
    .eq("status", "active")
    .in("id", Array.from(new Set(due.map((p) => p.campaign_id))));
  if (campErr) {
    console.warn(`[fila] leitura das campanhas falhou (segue sem trocar): ${campErr.message}`);
    return result;
  }
  const active = new Set(((campaigns ?? []) as { id: string }[]).map((c) => c.id));

  const todo = due
    .filter((p) => active.has(p.campaign_id))
    .sort((a, b) => Date.parse(a.scheduled_at) - Date.parse(b.scheduled_at))
    .slice(0, DEFER_MAX_PER_RUN);

  for (const post of todo) {
    try {
      const outcome = await deferOne(admin, post, paused);
      if (outcome === "swapped") result.swapped++;
      if (outcome === "cancelled") result.cancelled++;
    } catch (e) {
      console.warn(`[fila] post ${post.id}: troca do vídeo pausado falhou: ${(e as Error).message}`);
    }
  }
  return result;
}

async function deferOne(
  admin: SupabaseClient,
  post: DuePausedPost,
  paused: ReadonlySet<string>,
): Promise<"swapped" | "cancelled" | "skipped"> {
  const at = Date.parse(post.scheduled_at);
  const [laterRes, busyRes] = await Promise.all([
    admin
      .from("scheduled_posts")
      .select("id, video_id, video_url, caption")
      .eq("campaign_id", post.campaign_id)
      .eq("account_id", post.account_id)
      .eq("status", "pending")
      .gt("scheduled_at", post.scheduled_at)
      .order("scheduled_at", { ascending: false })
      .limit(SWAP_LOOKAHEAD),
    admin
      .from("scheduled_posts")
      .select("video_id")
      .eq("campaign_id", post.campaign_id)
      .neq("account_id", post.account_id)
      .in("status", ["pending", "publishing", "published"])
      .gte("scheduled_at", new Date(at - BUSY_WINDOW_MS).toISOString())
      .lte("scheduled_at", new Date(at + BUSY_WINDOW_MS).toISOString())
      .not("video_id", "is", null)
      .limit(PAGE),
  ]);
  if (laterRes.error) throw new Error(laterRes.error.message);
  // Sem a vizinhança, troca mesmo assim — só perde o desempate.
  const busy = new Set(busyRes.error ? [] : ((busyRes.data ?? []) as { video_id: string }[]).map((r) => r.video_id));
  const target = pickSwapTarget((laterRes.data ?? []) as LaterPost[], paused, busy);

  if (!target) {
    const { data, error } = await admin
      .from("scheduled_posts")
      .update({ status: "cancelled", error_message: PAUSED_VIDEO_CANCEL_MSG })
      .eq("id", post.id)
      .eq("status", "pending")
      .eq("video_id", post.video_id)
      .select("id");
    if (error) throw new Error(error.message);
    return data?.length ? "cancelled" : "skipped";
  }

  // Guardas status = pending + vídeo antigo: um run do cron que se sobrepõe a
  // este e já mexeu num dos dois posts faz este desistir. creation_id zerado:
  // o container pronto era do vídeo antigo.
  const { data: here, error: hereErr } = await admin
    .from("scheduled_posts")
    .update({ video_id: target.video_id, video_url: target.video_url, caption: target.caption, creation_id: null })
    .eq("id", post.id)
    .eq("status", "pending")
    .eq("video_id", post.video_id)
    .select("id");
  if (hereErr) throw new Error(hereErr.message);
  if (!here?.length) return "skipped";

  const { data: there, error: thereErr } = await admin
    .from("scheduled_posts")
    .update({ video_id: post.video_id, video_url: post.video_url, caption: post.caption, creation_id: null })
    .eq("id", target.id)
    .eq("status", "pending")
    .eq("video_id", target.video_id!)
    .select("id");
  if (thereErr || !there?.length) {
    // O outro post mudou no meio: desfaz este, senão o vídeo dele sairia duas vezes na conta.
    await admin
      .from("scheduled_posts")
      .update({ video_id: post.video_id, video_url: post.video_url, caption: post.caption })
      .eq("id", post.id)
      .eq("status", "pending")
      .eq("video_id", target.video_id!);
    if (thereErr) throw new Error(thereErr.message);
    return "skipped";
  }
  return "swapped";
}
