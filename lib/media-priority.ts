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
  } = ctx;

  if (accountIds.length === 0 || candidates.length === 0) return [];

  const rng = mulberry32(seed);
  const globalUsage = computeGlobalUsage(usageByAccount);

  // Filter out globally excluded videos (window claims + cooldown)
  const globallyAvailable = candidates.filter(
    (v) => !windowClaims.has(v.id) && !recentGlobalCooldown.has(v.id),
  );

  const results: AssignmentResult[] = [];
  // Track in-memory usage increments so subsequent accounts see updated counts
  const incrementalUsage = new Map<string, number>();

  for (let ai = 0; ai < accountIds.length; ai++) {
    const accountId = accountIds[ai];
    const posted = getPostedSet(usageByAccount, accountId);

    // Per-account pool: exclude what this account already posted
    let perAccountPool = globallyAvailable.filter((v) => !posted.has(v.id));

    let isCycleReset = false;

    // Cycle reset: if personal pool exhausted, allow all except last posted
    if (perAccountPool.length === 0 && globallyAvailable.length > 0) {
      isCycleReset = true;
      // Relax: only exclude the very last video posted by this account
      const lastVideo = getLastPostedVideo(usageByAccount, accountId);
      perAccountPool = globallyAvailable.filter(
        (v) => v.id !== lastVideo,
      );
      // If still empty after relaxation, use full global pool
      if (perAccountPool.length === 0) {
        perAccountPool = globallyAvailable;
      }
    }

    // Build effective global usage including incremental bumps from this run
    const effectiveGlobalUsage = new Map(globalUsage);
    for (const [vid, inc] of incrementalUsage) {
      effectiveGlobalUsage.set(
        vid,
        (effectiveGlobalUsage.get(vid) ?? 0) + inc,
      );
    }

    // Rank the per-account pool
    const ranked = buildRankedPool(
      perAccountPool,
      strategy,
      effectiveGlobalUsage,
      rng,
    );

    if (ranked.length === 0) continue;

    // Latin square offset for diversity within the round
    const index = ai % ranked.length;
    const selected = ranked[index];

    results.push({ accountId, video: selected, isCycleReset });

    // Bump incremental usage so next account sees this video as more used
    incrementalUsage.set(
      selected.id,
      (incrementalUsage.get(selected.id) ?? 0) + 1,
    );
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