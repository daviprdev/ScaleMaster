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

export function buildRankedPool(
  candidates: VideoCandidate[],
  strategy: PriorityStrategy,
  globalUsage: Map<string, number>,
  rng: () => number,
): VideoCandidate[] {
  if (candidates.length === 0) return [];

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
// Per-account posted set helper
// ---------------------------------------------------------------------------

function getPostedSet(
  usageByAccount: Map<string, Map<string, number>>,
  accountId: string,
): Set<string> {
  const videoMap = usageByAccount.get(accountId);
  if (!videoMap) return new Set();
  const posted = new Set<string>();
  for (const [videoId, count] of videoMap) {
    if (count > 0) posted.add(videoId);
  }
  return posted;
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
  rng: () => number,
): Map<string, VideoCandidate> {
  const result = new Map<string, VideoCandidate>();
  const videoToAccount = new Map<string, string>();

  // Pré-rankeia elegibilidade de cada conta por estratégia (estável por seed)
  const rankedEligibility = new Map<string, VideoCandidate[]>();
  for (const accountId of accountIds) {
    const eligible = eligibility.get(accountId) ?? [];
    rankedEligibility.set(accountId, buildRankedPool(eligible, strategy, globalUsage, rng));
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
  } = ctx;

  if (accountIds.length === 0 || candidates.length === 0 || videosPerAccount < 1) return [];

  const rng = mulberry32(seed);
  const baseGlobalUsage = computeGlobalUsage(usageByAccount);

  // Filter out globally excluded videos (window claims + cooldown)
  const globallyAvailable = candidates.filter(
    (v) => !windowClaims.has(v.id) && !recentGlobalCooldown.has(v.id),
  );

  if (globallyAvailable.length === 0) return [];

  const results: AssignmentResult[] = [];
  // Mutable usage map that accumulates across ALL rounds and accounts.
  // This ensures diversity: a video assigned to account A in round 0
  // becomes "more used" and less likely to be picked again in round 1.
  const liveUsage = new Map(baseGlobalUsage);
  // Per-account mutable posted sets — tracks what each account received
  // during this run so we don't repeat within the same batch.
  const livePosted = new Map<string, Set<string>>();
  for (const aid of accountIds) {
    livePosted.set(aid, new Set(getPostedSet(usageByAccount, aid)));
  }
  // Track last video per account to avoid immediate repetition on cycle reset.
  const lastVideoPerAccount = new Map<string, string | null>();
  for (const aid of accountIds) {
    lastVideoPerAccount.set(aid, getLastPostedVideo(usageByAccount, aid));
  }

  for (let round = 0; round < videosPerAccount; round++) {
    // Collect assignments for this round first, then commit them all at once.
    // This prevents ordering bias within a round (account[0] doesn't steal
    // from account[N] because both see the same pre-round state).
    const roundAssignments: { accountId: string; video: VideoCandidate; isCycleReset: boolean }[] = [];
    // Videos claimed within this round — prevents two accounts getting the
    // same video in the same round when alternatives exist.
    const roundClaims = new Set<string>();

    // Shuffle account order per round for fairness: without this, account[0]
    // always picks first and gets the best-ranked video every round.
    const shuffledAccountIndices = seededShuffle(
      accountIds.map((_, i) => i),
      rng,
    );

    // Scarcity: when globally available videos are fewer than accounts,
    // some repetition within the round is inevitable. Use modular
    // distribution to guarantee balanced assignment (e.g. 10/3 → 4/3/3,
    // 2/1 → both accounts get the same video).
    const scarcityDetected = globallyAvailable.length < shuffledAccountIndices.length;

    // P1: Matching bipartido para evitar reset guloso.
    // Caso A: existe atribuição sem repetição, mas a seleção gulosa reinicia ciclos.
    // Caso B: escassez ignora histórico individual.
    // Solução: construir grafo de elegibilidade (conta → vídeos inéditos) e
    // encontrar matching máximo antes de cair em fallback greedy.
    const accountEligibility = new Map<string, VideoCandidate[]>();
    for (const ai of shuffledAccountIndices) {
      const accountId = accountIds[ai];
      const posted = livePosted.get(accountId)!;
      const eligible = globallyAvailable.filter(
        (v) => !posted.has(v.id) && !roundClaims.has(v.id),
      );
      accountEligibility.set(accountId, eligible);
    }

    // Tenta matching máximo usando algoritmo guloso com backtracking simples.
    // Para N contas e M vídeos, complexidade O(N*M) na prática.
    const matchingResult = findMaximumMatching(
      shuffledAccountIndices.map((i) => accountIds[i]),
      accountEligibility,
      strategy,
      liveUsage,
      rng,
    );

    if (matchingResult && matchingResult.size > 0) {
      // P1 CORREÇÃO: Usar matching máximo (pode ser parcial ou perfeito).
      // PROBLEMA ANTERIOR: Só usava matching se fosse PERFEITO (size === accounts).
      // Isso fazia com que 11 contas/10 vídeos caíssem no fallback de escassez
      // mesmo quando o matching máximo encontrava 10 atribuições distintas.
      //
      // SOLUÇÃO: Usar todas as atribuições do matching máximo, depois preencher
      // contas restantes com fallback (greedy ou escassez conforme o caso).
      for (const [accountId, video] of matchingResult) {
        roundAssignments.push({ accountId, video, isCycleReset: false });
        roundClaims.add(video.id);
      }
      // Se matching foi perfeito, pula fallback
      if (matchingResult.size === shuffledAccountIndices.length) {
        // Todas as contas atribuídas — commit e próxima rodada
      } else if (scarcityDetected) {
        // P1 CORREÇÃO: Escassez real — menos vídeos que contas.
        // PROBLEMA ANTERIOR: O primeiro passa atribuía vídeos inéditos apenas para
        // contas com elegibilidade NÃO usada, marcando o vídeo como "used" após
        // a primeira atribuição. Isso impedia que outras contas com o mesmo vídeo
        // inédito o recebessem, resultando em distribuição desigual (2/3 em vez
        // de 3/3 no Caso B).
        //
        // SOLUÇÃO: Em escassez, permitir que múltiplas contas recebam o mesmo
        // vídeo inédito se ele for a única opção elegível para elas. O matching
        // máximo já tentou encontrar atribuições distintas; se falhou, é porque
        // não há solução perfeita — então distribuir repetições equilibradas
        // respeitando elegibilidade individual.
        const rankedAll = buildRankedPool(globallyAvailable, strategy, liveUsage, rng);
        if (rankedAll.length === 0) continue;

        // Identifica vídeos inéditos por conta (não usados no histórico pessoal)
        const accountUnpublished = new Map<string, VideoCandidate[]>();
        for (const ai of shuffledAccountIndices) {
          const accountId = accountIds[ai];
          const posted = livePosted.get(accountId)!;
          const eligible = accountEligibility.get(accountId) ?? [];
          const unpublished = eligible.filter((v) => !posted.has(v.id));
          accountUnpublished.set(accountId, unpublished);
        }

        // P1 CORREÇÃO: Híbrido — elegibilidade individual + distribuição modular.
        // PROBLEMA ANTERIOR 1: Primeiro passa atribuía mesmo vídeo para todas
        // as contas (191 para um vídeo em 200/10).
        // PROBLEMA ANTERIOR 2: Distribuição modular pura ignorava elegibilidade
        // individual, fazendo conta C receber v1 em vez de v2 (único inédito).
        //
        // SOLUÇÃO: Duas fases para contas não cobertas pelo matching:
        // Fase 1: Contas com APENAS 1 vídeo inédito elegível recebem esse vídeo
        //         (respeita elegibilidade individual crítica — Caso B).
        // Fase 2: Contas restantes recebem distribuição modular dos vídeos
        //         rankeados globalmente (garante equilíbrio em escassez extrema).
        const assignedAccounts = new Set<string>(matchingResult.keys());
        const remainingAccounts = shuffledAccountIndices
          .map((i) => accountIds[i])
          .filter((id) => !assignedAccounts.has(id));

        // Fase 1: Priorizar contas com elegibilidade restrita (apenas 1 inédito)
        const phase1Assigned = new Set<string>();
        for (const accountId of remainingAccounts) {
          const unpublished = accountUnpublished.get(accountId) ?? [];
          if (unpublished.length === 1) {
            // Única opção elegível — atribui sem hesitar
            const selected = unpublished[0];
            const posted = livePosted.get(accountId)!;
            const isCycleReset = posted.has(selected.id);
            roundAssignments.push({ accountId, video: selected, isCycleReset });
            phase1Assigned.add(accountId);
          }
        }

        // Fase 2: Distribuição modular para contas restantes
        const phase2Accounts = remainingAccounts.filter(id => !phase1Assigned.has(id));
        for (let si = 0; si < phase2Accounts.length; si++) {
          const accountId = phase2Accounts[si];
          const videoIndex = si % rankedAll.length;
          const selected = rankedAll[videoIndex];
          const posted = livePosted.get(accountId)!;
          const isCycleReset = posted.has(selected.id);
          roundAssignments.push({ accountId, video: selected, isCycleReset });
        }
      } else {
        // Fallback greedy: matching parcial mas não é escassez. Usa lógica original
        // mas com roundClaims para evitar duplicação na rodada.
        for (const ai of shuffledAccountIndices) {
          const accountId = accountIds[ai];
          // Pula contas já atribuídas pelo matching
          if (roundAssignments.some((r) => r.accountId === accountId)) continue;

          const posted = livePosted.get(accountId)!;
          let perAccountPool = globallyAvailable.filter(
            (v) => !posted.has(v.id) && !roundClaims.has(v.id),
          );

          let isCycleReset = false;

          // Cycle reset: personal pool exhausted → relax to all except last posted
          if (perAccountPool.length === 0 && globallyAvailable.length > 0) {
            isCycleReset = true;
            const lastVideo = lastVideoPerAccount.get(accountId);
            perAccountPool = globallyAvailable.filter(
              (v) => v.id !== lastVideo && !roundClaims.has(v.id),
            );
            if (perAccountPool.length === 0) {
              perAccountPool = globallyAvailable.filter((v) => !roundClaims.has(v.id));
            }
          }

          if (perAccountPool.length === 0) continue;

          const ranked = buildRankedPool(perAccountPool, strategy, liveUsage, rng);
          if (ranked.length === 0) continue;

          const selected = ranked[0];
          roundAssignments.push({ accountId, video: selected, isCycleReset });
          roundClaims.add(selected.id);
        }
      }
    } else {
      // Sem matching encontrado — fallback greedy completo
      for (const ai of shuffledAccountIndices) {
        const accountId = accountIds[ai];
        const posted = livePosted.get(accountId)!;
        let perAccountPool = globallyAvailable.filter(
          (v) => !posted.has(v.id) && !roundClaims.has(v.id),
        );

        let isCycleReset = false;

        if (perAccountPool.length === 0 && globallyAvailable.length > 0) {
          isCycleReset = true;
          const lastVideo = lastVideoPerAccount.get(accountId);
          perAccountPool = globallyAvailable.filter(
            (v) => v.id !== lastVideo && !roundClaims.has(v.id),
          );
          if (perAccountPool.length === 0) {
            perAccountPool = globallyAvailable.filter((v) => !roundClaims.has(v.id));
          }
        }

        if (perAccountPool.length === 0) continue;

        const ranked = buildRankedPool(perAccountPool, strategy, liveUsage, rng);
        if (ranked.length === 0) continue;

        const selected = ranked[0];
        roundAssignments.push({ accountId, video: selected, isCycleReset });
        roundClaims.add(selected.id);
      }
    }

    // Commit all round assignments at once
    for (const assignment of roundAssignments) {
      results.push(assignment);
      // Update live state for subsequent rounds
      livePosted.get(assignment.accountId)!.add(assignment.video.id);
      lastVideoPerAccount.set(assignment.accountId, assignment.video.id);
      liveUsage.set(
        assignment.video.id,
        (liveUsage.get(assignment.video.id) ?? 0) + 1,
      );
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getLastPostedVideo(
  usageByAccount: Map<string, Map<string, number>>,
  accountId: string,
): string | null {
  const videoMap = usageByAccount.get(accountId);
  if (!videoMap || videoMap.size === 0) return null;
  // Return any video with the highest usage count as a proxy for "last"
  let maxCount = -1;
  let lastId: string | null = null;
  for (const [videoId, count] of videoMap) {
    if (count > maxCount) {
      maxCount = count;
      lastId = videoId;
    }
  }
  return lastId;
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