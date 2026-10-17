/**
 * lib/inspiration-scrape.ts — busca de perfil nas Inspirações via ScrapeCreators,
 * DURÁVEL no servidor.
 *
 * Fluxo:
 *   1. POST /api/inspirations/scrape cria uma linha em `inspiration_scrape_searches`
 *      (status 'running') e inicia a coleta paginada por ScrapeCreators.
 *   2. `advanceSearch` percorre páginas usando `max_id`; cada página é salva
 *      incrementalmente em `scraped_profiles`. Se o usuário sair da página,
 *      o cron finalize-inspiration-scrapes retoma de onde parou.
 *   3. A busca termina quando `more_available === false` OU quando um erro
 *      permanente ocorre. Reels fixados não são cobertos pela rota de reels
 *      da ScrapeCreators — a execução é marcada como parcial nesse caso.
 *
 * Claim atômico (`processing_until`) impede que página e cron avancem a
 * mesma busca ao mesmo tempo.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  fetchUserReels,
  fetchPostDetail,
  type ReelItem,
} from "@/lib/scrapecreators-client";

// ── Compatibilidade com Clone (uso compartilhado de Apify) ────────────────────
// O Clone ainda usa Apify e importa `listAllItems` desta lib. A função foi
// movida para cá para manter o contrato de importação sem quebrar o build.
// Não é usada pelo fluxo de Inspirações (que agora usa ScrapeCreators).
import type { ApifyClient } from "apify-client";

/**
 * Lista todos os itens de um dataset do Apify, paginando automaticamente.
 * Usado pelo Clone (app/api/clone/search/poll) — NÃO usado por Inspirações.
 */
export async function listAllItems(
  client: ApifyClient,
  datasetId: string,
  limit = 1000
): Promise<Record<string, unknown>[]> {
  const all: Record<string, unknown>[] = [];
  let offset = 0;
  while (true) {
    const { items } = await client.dataset(datasetId).listItems({
      offset,
      limit,
    });
    if (!items || items.length === 0) break;
    all.push(...(items as Record<string, unknown>[]));
    if (items.length < limit) break;
    offset += items.length;
  }
  return all;
}

/** Tempo máximo de uma busca antes de expirar (3h). */
export const SEARCH_EXPIRE_MS = 3 * 60 * 60 * 1000;
const CLAIM_MS = 55_000;

/** Limite de segurança contra loops infinitos de paginação. */
const MAX_PAGES = 500;

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

export interface SearchRow {
  id: string;
  user_id: string;
  username: string;
  run_ids: string[];
  fallback_run_ids: string[];
  limit_items: number;
  status: "running" | "done" | "error";
  created_at: string;
  updated_at: string;
  error_message: string | null;
  reel_count: number | null;
}

export type AdvanceResult =
  | { status: "running" }
  | { status: "done"; reels: InspirationReelPayload[] }
  | { status: "error"; error: string };

export interface InspirationReelPayload {
  id: string;
  shortCode: string;
  thumbnailUrl: string | null;
  videoUrl: string;
  caption: string;
  originalCaption: string | null;
  sourceUrl: string | null;
  views: number;
  likes: number;
  comments: number;
  duration: number;
  owner: string;
  gradient: string;
}

export function normalizeUsername(raw: string): string {
  return raw.trim().replace(/^@/, "").replace(/\/+$/, "").toLowerCase();
}

// ── Normalização de ReelItem (ScrapeCreators) → InspirationReelPayload ────────

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() !== "" ? v : null;
}

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/** Extrai a melhor URL de vídeo disponível. */
function extractVideoUrl(media: ReelItem["media"]): string {
  const versions = media.video_versions;
  if (Array.isArray(versions) && versions.length > 0) {
    // Pega a de maior resolução (maior width)
    const sorted = [...versions].sort((a, b) => (b.width ?? 0) - (a.width ?? 0));
    return sorted[0]?.url ?? "";
  }
  return "";
}

/** Extrai thumbnail. */
function extractThumbnail(media: ReelItem["media"]): string | null {
  if (str(media.display_uri)) return media.display_uri!;
  const candidates = media.image_versions2?.candidates;
  if (Array.isArray(candidates) && candidates.length > 0) {
    const sorted = [...candidates].sort((a, b) => (b.width ?? 0) - (a.width ?? 0));
    return sorted[0]?.url ?? null;
  }
  return null;
}

/**
 * Converte um ReelItem da ScrapeCreators no formato interno do Scale Master.
 *
 * A legenda vem de `caption.text` quando disponível. A documentação informa
 * que a listagem pode não trazer legendas — nesse caso, `originalCaption`
 * fica null e pode ser complementado via fetchPostDetail.
 */
export function normalizeReelItem(
  item: ReelItem,
  fallbackUsername: string,
  index: number
): InspirationReelPayload {
  const m = item.media;
  const captionText = m.caption?.text ?? null;
  const owner = m.owner?.username ?? m.user?.username ?? fallbackUsername;
  const shortCode = m.code ?? "";
  const permalink = m.url ?? (shortCode ? `https://www.instagram.com/reel/${shortCode}/` : null);

  return {
    id: m.pk ?? m.id ?? shortCode ?? String(index),
    shortCode,
    thumbnailUrl: extractThumbnail(m),
    videoUrl: extractVideoUrl(m),
    caption: captionText ?? "",
    originalCaption: captionText,
    sourceUrl: permalink,
    views: num(m.play_count ?? m.ig_play_count),
    likes: num(m.like_count),
    comments: num(m.comment_count),
    duration: num(m.video_duration),
    owner,
    gradient: GRADIENTS[index % GRADIENTS.length],
  };
}

/**
 * Complementa legendas ausentes chamando o endpoint de detalhe do post.
 * Faz isso em lotes pequenos para não estourar créditos desnecessariamente.
 * Só chama para itens que realmente precisam (originalCaption === null).
 */
async function enrichCaptions(
  reels: InspirationReelPayload[],
  maxEnrichments = 20
): Promise<void> {
  const missing = reels.filter((r) => r.originalCaption === null && r.sourceUrl);
  const toEnrich = missing.slice(0, maxEnrichments);

  for (const reel of toEnrich) {
    try {
      const detail = await fetchPostDetail(reel.sourceUrl!);
      const edges = detail.data?.xdt_shortcode_media?.edge_media_to_caption?.edges;
      if (edges && edges.length > 0) {
        const text = edges[0].node.text;
        reel.originalCaption = text;
        reel.caption = text;
      } else {
        // Endpoint respondeu mas sem legenda → marca como vazia (não null)
        reel.originalCaption = "";
      }
    } catch {
      // Falha no enrichment não quebra a busca — legenda fica null
    }
  }
}

// ── Persistência no histórico ─────────────────────────────────────────────────

/** Grava/atualiza o perfil no histórico (scraped_profiles). */
export async function saveToHistory(
  admin: SupabaseClient,
  userId: string,
  username: string,
  reels: InspirationReelPayload[],
  profilePicUrl: string | null,
  fullName: string
): Promise<void> {
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

// ── Deduplicação ──────────────────────────────────────────────────────────────

function dedupByShortCode(reels: InspirationReelPayload[]): InspirationReelPayload[] {
  const seen = new Set<string>();
  const out: InspirationReelPayload[] = [];
  for (const r of reels) {
    const key = r.shortCode || r.id;
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(r);
  }
  return out;
}

// ── Helpers de banco ──────────────────────────────────────────────────────────

async function finish(admin: SupabaseClient, id: string, patch: Record<string, unknown>) {
  await (admin as any)
    .from("inspiration_scrape_searches")
    .update({ ...patch, processing_until: null, updated_at: new Date().toISOString() })
    .eq("id", id);
}

// ── Estado de paginação persistido em run_ids ─────────────────────────────────
// Reaproveitamos a coluna `run_ids` (text[]) para guardar o estado da paginação:
//   run_ids[0] = último max_id processado (cursor)
//   run_ids[1] = páginas já processadas (como string numérica)
//   run_ids[2] = total de reels acumulados (como string numérica)
// Isso evita criar migration nova e mantém compatibilidade com o schema existente.

interface PageState {
  cursor: string | null;
  pagesProcessed: number;
  reelsAccumulated: number;
}

function readPageState(search: SearchRow): PageState {
  return {
    cursor: search.run_ids[0] || null,
    pagesProcessed: Number(search.run_ids[1]) || 0,
    reelsAccumulated: Number(search.run_ids[2]) || 0,
  };
}

function writePageState(state: PageState): string[] {
  return [
    state.cursor ?? "",
    String(state.pagesProcessed),
    String(state.reelsAccumulated),
  ];
}

// ── advanceSearch ─────────────────────────────────────────────────────────────

/**
 * Avança uma busca: processa a próxima página de ScrapeCreators.
 * Seguro para chamadas concorrentes (claim atômico).
 *
 * Cada chamada processa UMA página e retorna. O polling/cron chama
 * repetidamente até `more_available === false`.
 */
export async function advanceSearch(
  admin: SupabaseClient,
  searchId: string
): Promise<AdvanceResult> {
  const nowIso = new Date().toISOString();

  // Claim atômico
  const { data: claimed } = await (admin as any)
    .from("inspiration_scrape_searches")
    .update({ processing_until: new Date(Date.now() + CLAIM_MS).toISOString(), updated_at: nowIso })
    .eq("id", searchId)
    .eq("status", "running")
    .or(`processing_until.is.null,processing_until.lt.${nowIso}`)
    .select("id, user_id, username, run_ids, fallback_run_ids, limit_items, status, created_at, updated_at, error_message, reel_count");

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
    // Expiração
    if (Date.now() - new Date(search.created_at).getTime() > SEARCH_EXPIRE_MS) {
      await finish(admin, search.id, {
        status: "error",
        error_message: "A busca expirou sem terminar.",
        finished_at: nowIso,
      });
      return { status: "error", error: "A busca expirou sem terminar." };
    }

    const pageState = readPageState(search);

    // Limite de segurança contra loops
    if (pageState.pagesProcessed >= MAX_PAGES) {
      await finish(admin, search.id, {
        status: "error",
        error_message: `Limite de ${MAX_PAGES} páginas atingido. A coleta pode estar incompleta.`,
        finished_at: nowIso,
      });
      return { status: "error", error: `Limite de ${MAX_PAGES} páginas atingido.` };
    }

    // Chama ScrapeCreators
    let response;
    try {
      response = await fetchUserReels(search.username, pageState.cursor);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);

      // Erros permanentes de conta da ScrapeCreators: sem créditos (402) ou
      // chave inválida (401). Antes caíam no "temporário" abaixo e a busca
      // ficava tentando a cada poll até expirar em 3h, sem dizer o motivo.
      if (msg.includes("HTTP 402") || msg.includes("HTTP 401")) {
        const reason = msg.includes("HTTP 402")
          ? "Os créditos da ScrapeCreators acabaram. Recarregue em scrapecreators.com ou use a fonte \"Conta leitora\"."
          : "A chave da ScrapeCreators foi recusada (SCRAPECREATORS_API_KEY inválida).";
        await finish(admin, search.id, {
          status: "error",
          error_message: reason,
          finished_at: nowIso,
        });
        return { status: "error", error: reason };
      }

      // Erros permanentes
      if (msg.includes("HTTP 404") || msg.includes("HTTP 403")) {
        await finish(admin, search.id, {
          status: "error",
          error_message: `Perfil @${search.username} não encontrado ou não é público.`,
          finished_at: nowIso,
        });
        return { status: "error", error: `Perfil não encontrado ou não é público.` };
      }

      // Erro temporário — libera o claim para retentar
      console.error(`[inspiration-scrape] busca ${search.id} falhou nesta tentativa:`, msg);
      await finish(admin, search.id, {});
      return { status: "running" };
    }

    if (!response.success || !Array.isArray(response.items)) {
      console.error(`[inspiration-scrape] resposta inválida para @${search.username}:`, response.status);
      await finish(admin, search.id, {});
      return { status: "running" };
    }

    // Página vazia com more_available = true → inconsistência
    if (response.items.length === 0 && response.paging_info.more_available) {
      console.warn(`[inspiration-scrape] @${search.username}: página vazia mas more_available=true`);
      await finish(admin, search.id, {
        status: "error",
        error_message: "A fonte retornou uma página vazia indicando que há mais conteúdo. Coleta parcial.",
        finished_at: nowIso,
      });
      return { status: "error", error: "Página vazia inesperada. Coleta parcial." };
    }

    // Cursor repetido → loop detectado
    const nextCursor = response.paging_info.max_id;
    if (nextCursor && nextCursor === pageState.cursor) {
      console.warn(`[inspiration-scrape] @${search.username}: cursor repetido, interrompendo`);
      await finish(admin, search.id, {
        status: "error",
        error_message: "Cursor de paginação repetido. Coleta parcial.",
        finished_at: nowIso,
      });
      return { status: "error", error: "Cursor repetido. Coleta parcial." };
    }

    // Normaliza os itens desta página
    const newReels = response.items.map((item, i) =>
      normalizeReelItem(item, search.username, pageState.reelsAccumulated + i)
    );

    // Carrega reels existentes do histórico para merge
    const { data: existingProfile } = await (admin as any)
      .from("scraped_profiles")
      .select("videos_data, profile_pic_url, full_name")
      .eq("user_id", search.user_id)
      .eq("username", search.username)
      .maybeSingle();

    const existingReels = (existingProfile?.videos_data ?? []) as InspirationReelPayload[];
    const merged = dedupByShortCode([...existingReels, ...newReels]);

    // Extrai info de perfil do primeiro item (se disponível)
    const firstMedia = response.items[0]?.media;
    const profilePicUrl = firstMedia?.owner?.profile_pic_url
      ?? firstMedia?.user?.profile_pic_url
      ?? existingProfile?.profile_pic_url
      ?? null;
    const fullName = firstMedia?.owner?.full_name
      ?? firstMedia?.user?.full_name
      ?? existingProfile?.full_name
      ?? search.username;

    // Salva incrementalmente no histórico
    await saveToHistory(admin, search.user_id, search.username, merged, profilePicUrl, fullName);

    // Atualiza estado de paginação
    const newState: PageState = {
      cursor: nextCursor ?? null,
      pagesProcessed: pageState.pagesProcessed + 1,
      reelsAccumulated: merged.length,
    };

    const moreAvailable = response.paging_info.more_available;

    // VERIFICAÇÃO DUPLA: Se a API diz que não há mais páginas, mas a página
    // atual está cheia (ou quase), pode ser uma inconsistência temporária da
    // API (rate limit, cache stale). Esperamos um pouco e tentamos novamente
    // com o mesmo cursor para confirmar se realmente acabou.
    // Isso evita parar prematuramente em perfis grandes.
    const PAGE_SIZE_THRESHOLD = 10; // Se a página tem >= 10 itens, desconfiamos de "fim"
    let confirmedEnd = !moreAvailable;

    if (!moreAvailable && response.items.length >= PAGE_SIZE_THRESHOLD && pageState.pagesProcessed < MAX_PAGES) {
      console.log(`[inspiration-scrape] @${search.username}: API disse fim mas página tem ${response.items.length} itens. Verificando novamente em 2s...`);
      await new Promise(resolve => setTimeout(resolve, 2000));

      try {
        const recheckResponse = await fetchUserReels(search.username, pageState.cursor);
        if (recheckResponse.success && recheckResponse.items.length > 0) {
          // Ainda tem conteúdo! Não é o fim.
          console.log(`[inspiration-scrape] @${search.username}: Verificação encontrou mais ${recheckResponse.items.length} itens. Continuando...`);
          confirmedEnd = false;
          // Processamos esses novos itens também
          const extraReels = recheckResponse.items.map((item, i) =>
            normalizeReelItem(item, search.username, pageState.reelsAccumulated + response.items.length + i)
          );
          const mergedWithExtra = dedupByShortCode([...merged, ...extraReels]);

          // Atualiza estado com o novo cursor da verificação
          const recheckCursor = recheckResponse.paging_info.max_id;
          const recheckMore = recheckResponse.paging_info.more_available;

          // Salva incrementalmente
          await saveToHistory(admin, search.user_id, search.username, mergedWithExtra, profilePicUrl, fullName);

          const newStateAfterRecheck: PageState = {
            cursor: recheckCursor ?? null,
            pagesProcessed: pageState.pagesProcessed + 1, // Conta a página original + esta verificação como progresso
            reelsAccumulated: mergedWithExtra.length,
          };

          if (!recheckMore) {
            // Agora sim, acabou de verdade (ou após a verificação)
            await enrichCaptions(mergedWithExtra);
            if (mergedWithExtra.some((r) => r.originalCaption !== null)) {
              await saveToHistory(admin, search.user_id, search.username, mergedWithExtra, profilePicUrl, fullName);
            }
            const pinnedNote = "Nota: Reels fixados podem não estar incluídos (limitação da fonte).";
            await finish(admin, search.id, {
              status: "done",
              reel_count: mergedWithExtra.length,
              error_message: pinnedNote,
              finished_at: new Date().toISOString(),
              run_ids: writePageState(newStateAfterRecheck),
            });
            console.log(`[inspiration-scrape] @${search.username}: ${mergedWithExtra.length} reels salvos em ${newStateAfterRecheck.pagesProcessed} páginas (após verificação)`);
            return { status: "done", reels: mergedWithExtra };
          } else {
            // Continua rodando com o novo estado
            await finish(admin, search.id, {
              run_ids: writePageState(newStateAfterRecheck),
              reel_count: mergedWithExtra.length,
            });
            return { status: "running" };
          }
        }
      } catch (err) {
        console.warn(`[inspiration-scrape] @${search.username}: Falha na verificação de fim, assumindo fim real.`, err);
        // Em caso de erro na verificação, assumimos que acabou mesmo
      }
    }

    if (confirmedEnd) {
      // Coleta terminou — enriquece legendas ausentes
      await enrichCaptions(merged);

      // Re-salva com legendas enriquecidas
      if (merged.some((r) => r.originalCaption !== null)) {
        await saveToHistory(admin, search.user_id, search.username, merged, profilePicUrl, fullName);
      }

      // Marca como done com aviso sobre reels fixados
      const pinnedNote = "Nota: Reels fixados podem não estar incluídos (limitação da fonte).";
      await finish(admin, search.id, {
        status: "done",
        reel_count: merged.length,
        error_message: pinnedNote,
        finished_at: new Date().toISOString(),
        run_ids: writePageState(newState),
      });

      console.log(
        `[inspiration-scrape] @${search.username}: ${merged.length} reels salvos em ${newState.pagesProcessed} páginas`
      );
      return { status: "done", reels: merged };
    }

    // Mais páginas disponíveis — atualiza estado e retorna running
    await finish(admin, search.id, {
      run_ids: writePageState(newState),
      reel_count: merged.length,
    });

    return { status: "running" };
  } catch (err) {
    // Erro inesperado — libera o claim
    console.error(`[inspiration-scrape] busca ${search.id} falhou:`, err);
    await finish(admin, search.id, {});
    return { status: "running" };
  }
}