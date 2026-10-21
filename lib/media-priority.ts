/**
 * Media Priority — shared module for views-based distribution with diversity.
 *
 * Pure functions (no DB calls). Routes fetch data and pass it via PriorityContext.
 * Deterministic given the same seed: retries produce identical assignments.
 */

export type PriorityStrategy = "views" | "least_usage" | "random";

export interface VideoCandidate {
  id: string;
  views: number;
  public_url: string;
  caption: string | null;
}

export interface PriorityContext {
  candidates: VideoCandidate[];
  accountIds: string[];
  /** accountId -> videoId -> usage count (from get_account_video_usage RPC) */
  usageByAccount: Map<string, Map<string, number>>;
  /** Videos already claimed in the current collision window */
  windowClaims: Set<string>;
  /** Videos used recently across all accounts (global cooldown) */
  recentGlobalCooldown: Set<string>;
  strategy: PriorityStrategy;
  /** Deterministic seed (e.g. "campaignId:cycleNumber") */
  seed: string;
  /** Collision window in minutes (default 5) */
  collisionWindowMinutes?: number;
  /** Number of videos to assign per account (default 1 for backwards compat).
   *  When > 1, assignVideos generates multiple rounds, each producing one
   *  assignment per account, respecting history and diversity across rounds. */
  videosPerAccount?: number;
  /** accountId -> últimos vídeos postados/agendados pela conta, MAIS RECENTE
   *  PRIMEIRO. Base do cooldown de recência: na virada de ciclo o pool volta a
   *  conter tudo, inclusive o vídeo do post imediatamente anterior. */
  recentByAccount?: Map<string, string[]>;
}

export interface AssignmentResult {
  accountId: string;
  video: VideoCandidate;
  isCycleReset: boolean;
}

// ---------------------------------------------------------------------------
// PRNG: mulberry32 — fast, deterministic, 32-bit state
// ---------------------------------------------------------------------------

function hashSeed(seed: string): number {
  let h = 0x811c9dc5; // FNV offset basis
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 0x01000193); // FNV prime
  }
  return h >>> 0;
}

function mulberry32(seed: string): () => number {
  let state = hashSeed(seed);
  return () => {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------------------
// Fisher-Yates shuffle with seeded RNG
// ---------------------------------------------------------------------------

function seededShuffle<T>(items: T[], rng: () => number): T[] {
  const arr = items.slice();
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// ---------------------------------------------------------------------------
// Global usage aggregation
// ---------------------------------------------------------------------------

export function computeGlobalUsage(
  usageByAccount: Map<string, Map<string, number>>,
): Map<string, number> {
  const global = new Map<string, number>();
  for (const [, videoMap] of usageByAccount) {
    for (const [videoId, count] of videoMap) {
      global.set(videoId, (global.get(videoId) ?? 0) + count);
    }
  }
  return global;
}

// ---------------------------------------------------------------------------
// Pool ranking
// ---------------------------------------------------------------------------

/**
 * Ordena o pool pela estratégia.
 *
 * `batchUsage` (opcional): quantas vezes cada vídeo já saiu no lote atual, em
 * qualquer conta. Em "views" e "random" ele vem ANTES da estratégia — sem isso,
 * num lote de N rodadas todas as contas postavam a mesma sequência de top views
 * deslocada de 1 slot (mesmo vídeo em várias contas na mesma janela, padrão que
 * a Meta suprime no alcance). Em "least_usage" o `globalUsage` já inclui o lote.
 */
export function buildRankedPool(
  candidates: VideoCandidate[],
  strategy: PriorityStrategy,
  globalUsage: Map<string, number>,
  rng: () => number,
  batchUsage?: Map<string, number>,
): VideoCandidate[] {
  if (candidates.length === 0) return [];
  if (!batchUsage || batchUsage.size === 0 || strategy === "least_usage") {
    return rankByStrategy(candidates, strategy, globalUsage, rng);
  }

  const levels = new Map<number, VideoCandidate[]>();
  for (const v of candidates) {
    const level = batchUsage.get(v.id) ?? 0;
    const list = levels.get(level);
    if (list) list.push(v);
    else levels.set(level, [v]);
  }
  const result: VideoCandidate[] = [];
  for (const level of [...levels.keys()].sort((a, b) => a - b)) {
    result.push(...rankByStrategy(levels.get(level)!, strategy, globalUsage, rng));
  }
  return result;
}

function rankByStrategy(
  candidates: VideoCandidate[],
  strategy: PriorityStrategy,
  globalUsage: Map<string, number>,
  rng: () => number,
): VideoCandidate[] {
  switch (strategy) {
    case "views": {
      // Sort DESC by views, ASC by global usage as tiebreak, then seeded shuffle within ties
      const sorted = candidates.slice().sort((a, b) => {
        if (b.views !== a.views) return b.views - a.views;
        const ua = globalUsage.get(a.id) ?? 0;
        const ub = globalUsage.get(b.id) ?? 0;
        if (ua !== ub) return ua - ub;
        return 0;
      });
      // Group by (views, usage) buckets and shuffle within each bucket
      const buckets: VideoCandidate[][] = [];
      let currentBucket: VideoCandidate[] = [sorted[0]];
      for (let i = 1; i < sorted.length; i++) {
        const prev = sorted[i - 1];
        const curr = sorted[i];
        const sameViews = curr.views === prev.views;
        const sameUsage =
          (globalUsage.get(curr.id) ?? 0) === (globalUsage.get(prev.id) ?? 0);
        if (sameViews && sameUsage) {
          currentBucket.push(curr);
        } else {
          buckets.push(currentBucket);
          currentBucket = [curr];
        }
      }
      buckets.push(currentBucket);

      const result: VideoCandidate[] = [];
      for (const bucket of buckets) {
        const shuffled = seededShuffle(bucket, rng);
        result.push(...shuffled);
      }
      return result;
    }

    case "least_usage": {
      // Sort ASC by global usage, seeded shuffle within ties (current behavior)
      const sorted = candidates.slice().sort((a, b) => {
        const ua = globalUsage.get(a.id) ?? 0;
        const ub = globalUsage.get(b.id) ?? 0;
        if (ua !== ub) return ua - ub;
        return 0;
      });
      const buckets: VideoCandidate[][] = [];
      let currentBucket: VideoCandidate[] = [sorted[0]];
      for (let i = 1; i < sorted.length; i++) {
        const prevUsage = globalUsage.get(sorted[i - 1].id) ?? 0;
        const currUsage = globalUsage.get(sorted[i].id) ?? 0;
        if (currUsage === prevUsage) {
          currentBucket.push(sorted[i]);
        } else {
          buckets.push(currentBucket);
          currentBucket = [sorted[i]];
        }
      }
      buckets.push(currentBucket);

      const result: VideoCandidate[] = [];
      for (const bucket of buckets) {
        result.push(...seededShuffle(bucket, rng));
      }
      return result;
    }

    case "random":
      return seededShuffle(candidates, rng);

    default:
      return seededShuffle(candidates, rng);
  }
}

// ---------------------------------------------------------------------------
// P1 CORREÇÃO: Maximum bipartite matching com complexidade controlada
// ---------------------------------------------------------------------------

/**
 * Encontra matching máximo entre contas e vídeos elegíveis usando BFS/DFS
 * com caminhos aumentantes (variante simplificada de Hopcroft-Karp).
 *
 * PROBLEMA ANTERIOR: Backtracking DFS puro tinha complexidade exponencial
 * O(N! * M!) no pior caso. Com 11 contas/10 vídeos ou 200/10, ultrapassava
 * 1.5s e bloqueava o processo Node.
 *
 * SOLUÇÃO: Algoritmo de caminhos aumentantes com complexidade O(V * E) onde
 * V = contas + vídeos, E = arestas de elegibilidade. Para grafos esparsos
 * (cada conta elegível para poucos vídeos), isso é muito mais rápido que
 * backtracking exponencial.
 *
 * Retorna matching máximo (não necessariamente perfeito). Se não houver
 * matching perfeito, retorna o melhor matching parcial encontrado.
 */
function findMaximumMatching(
  accountIds: string[],
  eligibility: Map<string, VideoCandidate[]>,
  strategy: PriorityStrategy,
  globalUsage: Map<string, number>,
  batchUsage: Map<string, number>,
  rng: () => number,
): Map<string, VideoCandidate> {
  const result = new Map<string, VideoCandidate>();
  const videoToAccount = new Map<string, string>();

  // Pré-rankeia elegibilidade de cada conta por estratégia (estável por seed)
  const rankedEligibility = new Map<string, VideoCandidate[]>();
  for (const accountId of accountIds) {
    const eligible = eligibility.get(accountId) ?? [];
    rankedEligibility.set(accountId, buildRankedPool(eligible, strategy, globalUsage, rng, batchUsage));
  }

  // BFS para encontrar caminho aumentante a partir de uma conta não匹配ada
  function findAugmentingPath(startAccount: string): string[] | null {
    const visited = new Set<string>();
    const queue: Array<{ account: string; path: string[] }> = [
      { account: startAccount, path: [startAccount] }
    ];
    visited.add(startAccount);

    while (queue.length > 0) {
      const { account, path } = queue.shift()!;
      const candidates = rankedEligibility.get(account) ?? [];

      for (const video of candidates) {
        const currentOwner = videoToAccount.get(video.id);

        if (currentOwner === undefined) {
          // Vídeo livre — caminho aumentante encontrado
          return [...path, video.id];
        }

        if (!visited.has(currentOwner)) {
          // Vídeo ocupado — tenta reatribuir o dono atual
          visited.add(currentOwner);
          queue.push({ account: currentOwner, path: [...path, video.id, currentOwner] });
        }
      }
    }

    return null; // Nenhum caminho aumentante encontrado
  }

  // Aplica caminho aumentante: alterna atribuições ao longo do caminho
  function applyAugmentingPath(path: string[]): void {
    for (let i = 0; i < path.length - 1; i += 2) {
      const account = path[i];
      const videoId = path[i + 1];
      const video = rankedEligibility.get(account)?.find(v => v.id === videoId);

      if (!video) continue;

      const previousOwner = videoToAccount.get(videoId);
      if (previousOwner) {
        // Remove atribuição anterior
        result.delete(previousOwner);
      }

      // Atribui vídeo à conta atual
      result.set(account, video);
      videoToAccount.set(videoId, account);
    }
  }

  // Itera sobre todas as contas tentando encontrar caminhos aumentantes
  // Limite de iterações para evitar loops infinitos em grafos patológicos
  const maxIterations = accountIds.length * 2;
  let iterations = 0;

  for (const accountId of accountIds) {
    if (result.has(accountId)) continue; // Já匹配ada

    iterations++;
    if (iterations > maxIterations) break; // Segurança contra loops

    const path = findAugmentingPath(accountId);
    if (path) {
      applyAugmentingPath(path);
    }
  }

  return result; // Matching máximo (pode ser parcial)
}

// ---------------------------------------------------------------------------
// Main assignment function
// ---------------------------------------------------------------------------

/** Últimos vídeos de cada conta que ficam fora do sorteio (mesmo valor do Loop). */
const RECENT_COOLDOWN = 12;

/**
 * Atribui vídeos às contas, uma rodada por slot (`videosPerAccount` rodadas).
 *
 * Elegibilidade por conta = vídeos no MENOR nível de uso daquela conta
 * (histórico + lote atual), fora do cooldown de recência. Conta nova → nível 0
 * (inéditos). Conta que já postou a pasta inteira → nível 1: percorre a pasta
 * toda de novo antes de repetir qualquer vídeo uma terceira vez.
 *
 * CORREÇÃO (2026-10-16): antes, a elegibilidade era só "nunca postado". Quando a
 * conta esgotava os inéditos, o "reset de ciclo" reabria o pool inteiro
 * (menos o último vídeo) e reordenava por views — a conta passava a receber o
 * mesmo top-2 alternado (A, B, A, B…) pelo resto da campanha. E o "último
 * vídeo" era inferido pelo maior contador de uso, não pela data: com
 * contadores empatados ele apontava o vídeo errado e o mesmo vídeo saía duas
 * vezes seguidas no cron de sincronização.
 */
export function assignVideos(ctx: PriorityContext): AssignmentResult[] {
  const {
    candidates,
    accountIds,
    usageByAccount,
    windowClaims,
    recentGlobalCooldown,
    strategy,
    seed,
    videosPerAccount = 1,
    recentByAccount,
  } = ctx;

  if (accountIds.length === 0 || candidates.length === 0 || videosPerAccount < 1) return [];

  const rng = mulberry32(seed);

  // Filter out globally excluded videos (window claims + cooldown)
  const globallyAvailable = candidates.filter(
    (v) => !windowClaims.has(v.id) && !recentGlobalCooldown.has(v.id),
  );

  if (globallyAvailable.length === 0) return [];
  const availableIds = new Set(globallyAvailable.map((v) => v.id));

  // Cooldown nunca passa de metade do pool — sempre sobra a outra metade.
  const cooldownSize = Math.min(RECENT_COOLDOWN, Math.floor(globallyAvailable.length / 2));

  const results: AssignmentResult[] = [];
  // Uso global (todas as contas, histórico + lote): critério do least_usage e
  // desempate do views. Acumula a cada rodada.
  const liveUsage = computeGlobalUsage(usageByAccount);
  // Quantas vezes cada vídeo já saiu NESTE lote, em qualquer conta.
  const batchUsage = new Map<string, number>();
  // Uso por conta (histórico + lote) e recência por conta (mais recente primeiro).
  const liveCounts = new Map<string, Map<string, number>>();
  const liveRecent = new Map<string, string[]>();
  for (const aid of accountIds) {
    liveCounts.set(aid, new Map(usageByAccount.get(aid) ?? []));
    liveRecent.set(
      aid,
      (recentByAccount?.get(aid) ?? []).filter((id) => availableIds.has(id)),
    );
  }

  const eligibleFor = (accountId: string): VideoCandidate[] => {
    const counts = liveCounts.get(accountId)!;
    const recentList = liveRecent.get(accountId)!;
    const recent = new Set<string>();
    for (const id of recentList) {
      if (recent.size >= cooldownSize) break;
      recent.add(id);
    }

    let pool = globallyAvailable.filter((v) => !recent.has(v.id));
    if (pool.length === 0) {
      // Pasta minúscula: ao menos nunca o vídeo imediatamente anterior.
      pool = globallyAvailable.filter((v) => v.id !== recentList[0]);
      if (pool.length === 0) pool = globallyAvailable;
    }

    let minLevel = Infinity;
    for (const v of pool) minLevel = Math.min(minLevel, counts.get(v.id) ?? 0);
    return pool.filter((v) => (counts.get(v.id) ?? 0) === minLevel);
  };

  for (let round = 0; round < videosPerAccount; round++) {
    // Ordem das contas embaralhada por rodada: sem isso, account[0] sempre
    // escolhe primeiro e leva o vídeo mais bem rankeado toda rodada.
    const order = seededShuffle(accountIds, rng);

    const eligibility = new Map<string, VideoCandidate[]>();
    for (const accountId of order) eligibility.set(accountId, eligibleFor(accountId));

    // Matching máximo: vídeos distintos entre as contas na mesma rodada sempre
    // que a elegibilidade individual permitir.
    const matching = findMaximumMatching(order, eligibility, strategy, liveUsage, batchUsage, rng);

    const roundAssignments: AssignmentResult[] = [];
    const roundUsage = new Map<string, number>();
    const assign = (accountId: string, video: VideoCandidate) => {
      const used = liveCounts.get(accountId)!.get(video.id) ?? 0;
      roundAssignments.push({ accountId, video, isCycleReset: used > 0 });
      roundUsage.set(video.id, (roundUsage.get(video.id) ?? 0) + 1);
    };

    for (const [accountId, video] of matching) assign(accountId, video);

    // Contas que o matching não cobriu (escassez: menos vídeos elegíveis do que
    // contas). Cada uma fica no SEU nível mínimo — nunca troca um inédito por
    // um repetido — e, entre os elegíveis, leva o menos usado nesta rodada,
    // equilibrando a repetição inevitável (ex.: 10 contas / 3 vídeos → 4/3/3).
    for (const accountId of order) {
      if (matching.has(accountId)) continue;
      const eligible = eligibility.get(accountId)!;
      if (eligible.length === 0) continue;

      const ranked = buildRankedPool(eligible, strategy, liveUsage, rng, batchUsage);
      let selected = ranked[0];
      let best = roundUsage.get(selected.id) ?? 0;
      for (const v of ranked) {
        if (best === 0) break;
        const u = roundUsage.get(v.id) ?? 0;
        if (u < best) {
          best = u;
          selected = v;
        }
      }
      assign(accountId, selected);
    }

    // Commit da rodada: as próximas rodadas enxergam o que saiu nesta.
    for (const assignment of roundAssignments) {
      results.push(assignment);
      const { accountId, video } = assignment;
      const counts = liveCounts.get(accountId)!;
      counts.set(video.id, (counts.get(video.id) ?? 0) + 1);
      liveRecent.get(accountId)!.unshift(video.id);
      liveUsage.set(video.id, (liveUsage.get(video.id) ?? 0) + 1);
      batchUsage.set(video.id, (batchUsage.get(video.id) ?? 0) + 1);
    }
  }

  return results;
}

/**
 * Validate that a priority strategy value is valid.
 * Returns the strategy if valid, or "least_usage" as safe default.
 */
export function normalizePriorityStrategy(
  value: string | undefined | null,
): PriorityStrategy {
  if (value === "views" || value === "least_usage" || value === "random") {
    return value;
  }
  return "least_usage";
}

// ---------------------------------------------------------------------------
// Rodízio fixo — modo "fila ideal" do Raio-X da fila
// ---------------------------------------------------------------------------

/** Mesmo formato que o distribute consome de assignVideos (só usa accountId e video.id). */
export interface RotationAssignment {
  accountId: string;
  video: Pick<VideoCandidate, "id">;
  /** Sempre false: o rodízio ignora o histórico (repost é permitido). */
  isCycleReset: boolean;
}

/**
 * Rodízio da fila ideal (docs/fila-ideal.md §5 e §12): na rodada `k` a conta
 * da posição `i` recebe `videoIds[(i + k) mod N]`, para k = 0..N−1.
 *
 * - A ordem dos vídeos (score) e a das contas (ranking) definem o rodízio.
 * - Repost permitido: o histórico da conta é ignorado de propósito — a lista
 *   já são os vídeos que mais renderam na fila.
 * - Nunca o mesmo vídeo 2× para a mesma conta no ciclo: cada conta passa por
 *   cada vídeo exatamente uma vez.
 * - Com M > N, as contas i e i+N seguem a mesma sequência (o stagger entre
 *   contas separa as duas publicações do mesmo vídeo).
 *
 * Puro e determinístico. Ids repetidos são ignorados (fica a 1ª ocorrência).
 * Resultado em ordem de rodada, contas na ordem recebida — igual ao assignVideos.
 */
export function assignRotation(accountIds: string[], videoIds: string[]): RotationAssignment[] {
  const accounts = [...new Set(accountIds)];
  const videos = [...new Set(videoIds)];
  const n = videos.length;
  if (accounts.length === 0 || n === 0) return [];

  const results: RotationAssignment[] = [];
  for (let k = 0; k < n; k++) {
    for (let i = 0; i < accounts.length; i++) {
      results.push({
        accountId: accounts[i],
        video: { id: videos[(i + k) % n] },
        isCycleReset: false,
      });
    }
  }
  return results;
}