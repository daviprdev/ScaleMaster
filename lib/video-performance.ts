/**
 * Desempenho REAL de cada vídeo nas contas do próprio usuário — a resposta da
 * Meta ao vídeo, não às views da origem.
 *
 * Medido em produção (2026-10-19, 460 Reels com 4h+ de vida, 71 vídeos, 23
 * contas): as views de um Reel dependem do VÍDEO muito mais do que da conta ou
 * da ordem em que ele saiu. 21 dos 71 vídeos (30%) ficaram com mediana de 14
 * views em TODAS as contas que os postaram — a Meta não os recomenda —, enquanto
 * os demais pararam em ~185 e 3 vídeos estouraram (média de 932 por cópia, até
 * 3.600). Distribuir pela pasta inteira gastava 29% dos posts em vídeos mortos.
 *
 * Classificação relativa a uma BASE = percentil 75 das cópias maduras do
 * usuário (continua valendo quando as contas crescerem; o p75 e não a mediana
 * porque uma pasta com muitos vídeos mortos derrubaria a mediana junto):
 *   dead   → 3+ cópias maduras, mediana < 20% da base e nenhuma cópia acima de
 *            2× a base. Sai do sorteio enquanto sobrarem vídeos vivos.
 *   winner → alguma cópia madura passou de max(1000, 5× a base). Vem primeiro na
 *            estratégia "views".
 *   normal → o resto com dados. Sem dados (nunca postado) = sem classificação.
 *
 * "Madura" = métrica lida 4h+ depois de publicar: medido, o Reel novo para de
 * crescer nesse ponto (mediana 150 com 4–8h, 171 com 8h+).
 *
 * Janela de 14 dias: um vídeo morto não gera cópias novas, então depois de 14
 * dias ele volta a "sem dados" e ganha outra chance.
 */

export type PerformanceTier = "winner" | "normal" | "dead";

export const PERF_MATURE_HOURS = 4;
export const PERF_LOOKBACK_DAYS = 14;
/** Cópias maduras mínimas para declarar um vídeo morto. */
export const DEAD_MIN_COPIES = 3;
/** Cópias maduras mínimas (todos os vídeos somados) para existir uma base. */
export const BASELINE_MIN_COPIES = 10;
/** Vídeos vivos mínimos para tirar os mortos do sorteio. */
export const MIN_ALIVE_POOL = 3;

const H = 60 * 60 * 1000;
const CACHE_TTL_MS = 10 * 60 * 1000;
const ID_CHUNK = 100;

function median(sorted: number[]): number {
  const n = sorted.length;
  if (n === 0) return 0;
  return n % 2 ? sorted[(n - 1) / 2] : (sorted[n / 2 - 1] + sorted[n / 2]) / 2;
}

/**
 * Classifica cada vídeo a partir das views das suas cópias maduras.
 * Pura — `samples` é videoId → views de cada cópia madura.
 */
export function classifyPerformance(samples: Map<string, number[]>): Map<string, PerformanceTier> {
  const tiers = new Map<string, PerformanceTier>();
  const all: number[] = [];
  for (const views of samples.values()) all.push(...views);
  if (all.length < BASELINE_MIN_COPIES) return tiers;

  all.sort((a, b) => a - b);
  const baseline = all[Math.min(all.length - 1, Math.floor(all.length * 0.75))];
  if (baseline <= 0) return tiers;

  const winnerViews = Math.max(1000, 5 * baseline);
  for (const [videoId, views] of samples) {
    if (views.length === 0) continue;
    const sorted = views.slice().sort((a, b) => a - b);
    const max = sorted[sorted.length - 1];
    if (max >= winnerViews) {
      tiers.set(videoId, "winner");
    } else if (
      sorted.length >= DEAD_MIN_COPIES &&
      median(sorted) < 0.2 * baseline &&
      max < 2 * baseline
    ) {
      tiers.set(videoId, "dead");
    } else {
      tiers.set(videoId, "normal");
    }
  }
  return tiers;
}

// ── Leitura ─────────────────────────────────────────────────────────────────

interface PerfRow {
  video_id: string;
  insights_plays: number | null;
  at: string | null;
  insights_fetched_at: string | null;
}

type Query = {
  select: (cols: string) => Query;
  eq: (col: string, v: unknown) => Query;
  in: (col: string, v: unknown[]) => Query;
  not: (col: string, op: string, v: unknown) => Query;
  gte: (col: string, v: unknown) => Query;
  order: (col: string, o: { ascending: boolean }) => Query;
  range: (from: number, to: number) => PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>;
};
type Admin = { from: (table: string) => Query };

/** Cópia madura → views; senão null. */
function maturedViews(row: PerfRow): number | null {
  if (row.insights_plays === null || !row.at || !row.insights_fetched_at) return null;
  const age = new Date(row.insights_fetched_at).getTime() - new Date(row.at).getTime();
  return age >= PERF_MATURE_HOURS * H ? row.insights_plays : null;
}

async function readAll(
  admin: Admin,
  table: "scheduled_posts" | "pending_containers",
  atCol: "published_at" | "created_at",
  userId: string,
  videoIds: string[],
  sinceIso: string
): Promise<PerfRow[]> {
  const out: PerfRow[] = [];
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await admin
      .from(table)
      .select(`id, video_id, insights_plays, insights_fetched_at, ${atCol}`)
      .eq("user_id", userId)
      .eq("status", "published")
      .in("video_id", videoIds)
      .not("insights_plays", "is", null)
      .gte(atCol, sinceIso)
      .order("id", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`${table}: ${error.message}`);
    const page = (data ?? []) as Record<string, unknown>[];
    for (const r of page) {
      out.push({
        video_id: r.video_id as string,
        insights_plays: r.insights_plays as number | null,
        at: r[atCol] as string | null,
        insights_fetched_at: r.insights_fetched_at as string | null,
      });
    }
    if (page.length < PAGE) break;
  }
  return out;
}

// Cache por vídeo: o process-loops roda a cada minuto e as métricas só mudam a
// cada 4h (cadência do sync-post-insights) — reler tudo a cada tick é desperdício.
const sampleCache = new Map<string, { at: number; views: number[] }>();

/**
 * Views das cópias maduras de cada vídeo (Postar/Clonar via scheduled_posts e
 * Loop via pending_containers), do próprio usuário, nos últimos 14 dias.
 *
 * Nunca lança: desempenho é otimização. Se a leitura falhar, devolve o que tem
 * em cache (ou nada) e a distribuição segue como antes.
 */
export async function fetchVideoSamples(
  admin: unknown,
  userId: string,
  videoIds: string[]
): Promise<Map<string, number[]>> {
  const now = Date.now();
  const samples = new Map<string, number[]>();
  const stale: string[] = [];
  for (const id of new Set(videoIds)) {
    const hit = sampleCache.get(`${userId}:${id}`);
    if (hit && now - hit.at < CACHE_TTL_MS) samples.set(id, hit.views);
    else stale.push(id);
  }
  if (stale.length === 0) return samples;

  const sinceIso = new Date(now - PERF_LOOKBACK_DAYS * 24 * H).toISOString();
  try {
    const fresh = new Map<string, number[]>(stale.map((id) => [id, []]));
    for (let i = 0; i < stale.length; i += ID_CHUNK) {
      const chunk = stale.slice(i, i + ID_CHUNK);
      const [posts, containers] = await Promise.all([
        readAll(admin as Admin, "scheduled_posts", "published_at", userId, chunk, sinceIso),
        readAll(admin as Admin, "pending_containers", "created_at", userId, chunk, sinceIso),
      ]);
      for (const row of [...posts, ...containers]) {
        const v = maturedViews(row);
        if (v !== null) fresh.get(row.video_id)?.push(v);
      }
    }
    for (const [id, views] of fresh) {
      sampleCache.set(`${userId}:${id}`, { at: now, views });
      samples.set(id, views);
    }
  } catch (err) {
    console.warn(
      `[video-performance] leitura falhou, seguindo sem filtro de desempenho: ${(err as Error).message}`
    );
  }
  return samples;
}

/** Atalho: lê as amostras e classifica. Mesma garantia de nunca lançar. */
export async function fetchPerformanceTiers(
  admin: unknown,
  userId: string,
  videoIds: string[]
): Promise<Map<string, PerformanceTier>> {
  const tiers = classifyPerformance(await fetchVideoSamples(admin, userId, videoIds));
  let dead = 0;
  let winners = 0;
  for (const t of tiers.values()) {
    if (t === "dead") dead++;
    else if (t === "winner") winners++;
  }
  if (dead || winners) {
    console.log(
      `[video-performance] user=${userId.slice(0, 8)} ${videoIds.length} vídeo(s): ` +
      `${dead} sem entrega (fora do sorteio), ${winners} vencedor(es) priorizado(s).`
    );
  }
  return tiers;
}
