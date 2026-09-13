/**
 * lib/inspiration-scrape.ts — busca de perfil nas Inspirações via Apify,
 * DURÁVEL no servidor.
 *
 * Fluxo:
 *   1. POST /api/inspirations/scrape inicia N runs (1 por token) e grava uma
 *      linha em `inspiration_scrape_searches` (status 'running').
 *   2. `advanceSearch` confere os runs; quando todos terminam, junta os itens,
 *      normaliza e grava em `scraped_profiles` (histórico) — com await.
 *   3. Quem chama `advanceSearch`: o polling da página E o cron
 *      finalize-inspiration-scrapes. Se o usuário sair da página, o cron
 *      termina o trabalho; a busca paga nunca se perde.
 *
 * Um claim atômico (`processing_until`) impede que página e cron avancem a
 * mesma busca ao mesmo tempo — o que poderia iniciar o run de fallback (pago)
 * duas vezes.
 */

import { ApifyClient } from "apify-client";
import type { SupabaseClient } from "@supabase/supabase-js";
import { resolveApifyTokens } from "@/lib/apify-token-pool";
import { normalizeScrapedReel, resolveVideoUrl } from "@/lib/scraped-reel";

export const APIFY_ACTOR = "apify/instagram-scraper";
/** Busca 'running' mais velha que isso vira erro (runs da Apify não duram tanto). */
export const SEARCH_EXPIRE_MS = 3 * 60 * 60 * 1000;
const CLAIM_MS = 55_000;

const GRADIENTS = [
  "from-violet-600 to-purple-800",
  "from-cyan-500 to-blue-700",
  "from-pink-500 to-rose-700",
  "from-emerald-500 to-teal-700",
  "from-amber-500 to-orange-700",
  "from-indigo-500 to-violet-700",
  "from-red-500 to-pink-700",
  "from-teal-500 to-cyan-700",
  "from-fuchsia-500 to-purple-700",
  "from-lime-500 to-green-700",
  "from-sky-500 to-indigo-700",
  "from-orange-500 to-amber-700",
];

export const actorInput = (url: string, limit: number) => ({
  directUrls: [url],
  resultsType: "posts",
  resultsLimit: limit,
  maxRequestsPerCrawl: Math.max(600, limit * 2),
  proxyConfiguration: { useApifyProxy: true },
});

export interface SearchRow {
  id: string;
  user_id: string;
  username: string;
  run_ids: string[];
  fallback_run_ids: string[];
  limit_items: number;
  status: "running" | "done" | "error";
  created_at: string;
}

export type AdvanceResult =
  | { status: "running" }
  | { status: "done"; reels: InspirationReelPayload[] }
  | { status: "error"; error: string };

export type InspirationReelPayload = ReturnType<typeof processItems>[number];

export function normalizeUsername(raw: string): string {
  return raw.trim().replace(/^@/, "").replace(/\/+$/, "").toLowerCase();
}

export function processItems(items: unknown[], username: string) {
  return (items as Record<string, unknown>[])
    .filter((item) => item.type === "Video" || resolveVideoUrl(item))
    .map((item, i) => {
      const videoUrl = resolveVideoUrl(item);
      // Normalização central (lib/scraped-reel.ts). Legenda vai INTEIRA.
      const reel = normalizeScrapedReel(item, username, i);
      return {
        id: reel.id,
        shortCode: reel.shortCode,
        thumbnailUrl: reel.thumbnailUrl,
        videoUrl,
        caption: reel.originalCaption ?? "",
        originalCaption: reel.originalCaption,
        sourceUrl: reel.sourceUrl,
        views: reel.views,
        likes: reel.likes,
        comments: reel.comments,
        duration: reel.duration,
        owner: reel.sourceUsername ?? username,
        gradient: GRADIENTS[i % GRADIENTS.length],
      };
    });
}

/** Grava no histórico (scraped_profiles). Lança em erro — o chamador decide. */
export async function saveToHistory(
  admin: SupabaseClient,
  userId: string,
  username: string,
  reels: object[],
  items: unknown[]
): Promise<void> {
  const first = (items[0] ?? {}) as Record<string, unknown>;
  const ownerObj = (first.owner ?? {}) as Record<string, unknown>;
  const fullName = String(first.ownerFullName ?? first.ownerUsername ?? username);
  const profilePicUrl =
    (first.ownerProfilePicUrl as string | null | undefined) ||
    (first.profilePicUrl as string | null | undefined) ||
    (ownerObj.profilePicUrl as string | null | undefined) ||
    null;

  const { error } = await (admin as any).from("scraped_profiles").upsert(
    {
      user_id: userId,
      username,
      full_name: fullName,
      profile_pic_url: profilePicUrl,
      videos_data: reels,
      video_count: reels.length,
      scraped_at: new Date().toISOString(),
    },
    { onConflict: "user_id,username", ignoreDuplicates: false }
  );
  if (error) throw new Error(`scraped_profiles: ${error.message}`);
}

/** Localiza o run em algum token do pool (cada run pertence a um token). */
async function findRun(runId: string, tokens: string[]) {
  for (const token of tokens) {
    try {
      const client = new ApifyClient({ token });
      const run = (await client.run(runId).get()) as Record<string, unknown> | undefined;
      if (run) return { client, status: run.status as string, datasetId: run.defaultDatasetId as string };
    } catch { /* token errado — tenta o próximo */ }
  }
  return null;
}

/** Lê TODOS os itens do dataset, paginando (perfis com 500+ vídeos). */
export async function listAllItems(client: ApifyClient, datasetId: string): Promise<unknown[]> {
  const out: unknown[] = [];
  const PAGE = 500;
  for (let offset = 0; ; offset += PAGE) {
    const { items } = await client.dataset(datasetId).listItems({ offset, limit: PAGE });
    const list = Array.isArray(items) ? items : [];
    out.push(...list);
    if (list.length < PAGE) break;
  }
  return out;
}

function dedupByShortCode(lists: unknown[][]): unknown[] {
  const seen = new Set<string>();
  const out: unknown[] = [];
  for (const list of lists) {
    for (const item of list) {
      const sc = String((item as Record<string, unknown>).shortCode ?? "");
      if (sc && seen.has(sc)) continue;
      if (sc) seen.add(sc);
      out.push(item);
    }
  }
  return out;
}

async function finish(admin: SupabaseClient, id: string, patch: Record<string, unknown>) {
  await (admin as any)
    .from("inspiration_scrape_searches")
    .update({ ...patch, processing_until: null, updated_at: new Date().toISOString() })
    .eq("id", id);
}

/**
 * Avança uma busca: se todos os runs terminaram, salva no histórico e marca
 * 'done'. Seguro para chamadas concorrentes (claim atômico).
 */
export async function advanceSearch(admin: SupabaseClient, searchId: string): Promise<AdvanceResult> {
  const nowIso = new Date().toISOString();
  const { data: claimed } = await (admin as any)
    .from("inspiration_scrape_searches")
    .update({ processing_until: new Date(Date.now() + CLAIM_MS).toISOString(), updated_at: nowIso })
    .eq("id", searchId)
    .eq("status", "running")
    .or(`processing_until.is.null,processing_until.lt.${nowIso}`)
    .select("id, user_id, username, run_ids, fallback_run_ids, limit_items, status, created_at");

  const search = (claimed?.[0] ?? null) as SearchRow | null;

  if (!search) {
    // Não conseguiu o claim: ou já terminou, ou outro processo está avançando.
    const { data: row } = await (admin as any)
      .from("inspiration_scrape_searches")
      .select("status, username, user_id, error_message")
      .eq("id", searchId)
      .maybeSingle();
    if (!row) return { status: "error", error: "Busca não encontrada." };
    if (row.status === "error") return { status: "error", error: row.error_message ?? "Falha na busca." };
    if (row.status === "done") {
      const { data: profile } = await (admin as any)
        .from("scraped_profiles")
        .select("videos_data")
        .eq("user_id", row.user_id)
        .eq("username", row.username)
        .maybeSingle();
      return { status: "done", reels: (profile?.videos_data ?? []) as InspirationReelPayload[] };
    }
    return { status: "running" };
  }

  try {
    if (Date.now() - new Date(search.created_at).getTime() > SEARCH_EXPIRE_MS) {
      await finish(admin, search.id, {
        status: "error",
        error_message: "A busca expirou sem terminar na Apify.",
        finished_at: nowIso,
      });
      return { status: "error", error: "A busca expirou sem terminar na Apify." };
    }

    const tokens = resolveApifyTokens();
    const pending: string[] = [];
    const fallbacks = new Set(search.fallback_run_ids);
    const newFallbacks: string[] = [];
    /** Runs vazios substituídos por um fallback — saem da lista. */
    const replaced = new Set<string>();
    const lists: unknown[][] = [];

    for (const runId of search.run_ids) {
      const found = await findRun(runId, tokens);
      if (!found) {
        console.warn(`[inspiration-scrape] run ${runId} não encontrado em nenhum token — ignorando`);
        continue;
      }
      if (found.status === "RUNNING" || found.status === "READY") {
        pending.push(runId);
        continue;
      }
      if (found.status !== "SUCCEEDED") {
        console.warn(`[inspiration-scrape] run ${runId} terminou com ${found.status}`);
        continue;
      }

      const items = await listAllItems(found.client, found.datasetId);
      if (items.length === 0 && !fallbacks.has(runId)) {
        // /reels/ vazio: tenta a URL do perfil principal com o mesmo token.
        try {
          const fb = await found.client
            .actor(APIFY_ACTOR)
            .start(actorInput(`https://www.instagram.com/${search.username}/`, search.limit_items));
          pending.push(fb.id);
          newFallbacks.push(fb.id);
          replaced.add(runId);
          console.log(`[inspiration-scrape] @${search.username}: run ${runId} vazio — fallback ${fb.id}`);
        } catch (err) {
          console.warn(`[inspiration-scrape] fallback falhou: ${err}`);
        }
        continue;
      }
      lists.push(items);
    }

    if (pending.length > 0) {
      // Runs já concluídos com itens continuam na lista (são relidos ao final);
      // runs vazios trocados por fallback saem, e o fallback entra.
      await finish(admin, search.id, {
        run_ids: [...search.run_ids.filter((r) => !replaced.has(r)), ...newFallbacks],
        fallback_run_ids: [...search.fallback_run_ids, ...newFallbacks],
      });
      return { status: "running" };
    }

    const allItems = dedupByShortCode(lists);
    const reels = processItems(allItems, search.username);

    if (reels.length === 0) {
      const msg = `Nenhum conteúdo encontrado para @${search.username}. O perfil pode ser privado ou inexistente.`;
      await finish(admin, search.id, { status: "error", error_message: msg, finished_at: new Date().toISOString() });
      return { status: "error", error: msg };
    }

    await saveToHistory(admin, search.user_id, search.username, reels, allItems);
    await finish(admin, search.id, {
      status: "done",
      reel_count: reels.length,
      error_message: null,
      finished_at: new Date().toISOString(),
    });
    console.log(`[inspiration-scrape] @${search.username}: ${reels.length} reels salvos no histórico`);
    return { status: "done", reels };
  } catch (err) {
    // Erro transitório (Apify/banco): libera o claim; tenta de novo no próximo ciclo.
    console.error(`[inspiration-scrape] busca ${search.id} falhou nesta tentativa:`, err);
    await finish(admin, search.id, {});
    return { status: "running" };
  }
}
