#!/usr/bin/env node
/**
 * Simulation script for media-priority distribution strategy.
 *
 * Usage:
 *   node scripts/simulate-priority.mjs                          # default: 5 accounts, 10 videos, 3 rounds
 *   node scripts/simulate-priority.mjs --accounts 10 --videos 3 --rounds 5
 *   node scripts/simulate-priority.mjs --strategy least_usage
 *
 * Outputs an assignment matrix showing which video each account gets per round,
 * along with view counts and collision statistics.
 */

// Inline the pure functions from lib/media-priority.ts (compiled to JS)
// so this script runs without a build step.

function hashSeed(seed) {
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function mulberry32(seed) {
  let state = hashSeed(seed);
  return () => {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function seededShuffle(items, rng) {
  const arr = items.slice();
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function computeGlobalUsage(usageByAccount) {
  const global = new Map();
  for (const [, videoMap] of usageByAccount) {
    for (const [videoId, count] of videoMap) {
      global.set(videoId, (global.get(videoId) ?? 0) + count);
    }
  }
  return global;
}

function buildRankedPool(candidates, strategy, globalUsage, rng) {
  if (candidates.length === 0) return [];

  switch (strategy) {
    case "views": {
      const sorted = candidates.slice().sort((a, b) => {
        if (b.views !== a.views) return b.views - a.views;
        const ua = globalUsage.get(a.id) ?? 0;
        const ub = globalUsage.get(b.id) ?? 0;
        if (ua !== ub) return ua - ub;
        return 0;
      });
      const buckets = [];
      let currentBucket = [sorted[0]];
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
      const result = [];
      for (const bucket of buckets) {
        result.push(...seededShuffle(bucket, rng));
      }
      return result;
    }
    case "least_usage": {
      const sorted = candidates.slice().sort((a, b) => {
        const ua = globalUsage.get(a.id) ?? 0;
        const ub = globalUsage.get(b.id) ?? 0;
        if (ua !== ub) return ua - ub;
        return 0;
      });
      const buckets = [];
      let currentBucket = [sorted[0]];
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
      const result = [];
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

function getPostedSet(usageByAccount, accountId) {
  const videoMap = usageByAccount.get(accountId);
  if (!videoMap) return new Set();
  const posted = new Set();
  for (const [videoId, count] of videoMap) {
    if (count > 0) posted.add(videoId);
  }
  return posted;
}

function getLastPostedVideo(usageByAccount, accountId) {
  const videoMap = usageByAccount.get(accountId);
  if (!videoMap || videoMap.size === 0) return null;
  let maxCount = -1;
  let lastId = null;
  for (const [videoId, count] of videoMap) {
    if (count > maxCount) {
      maxCount = count;
      lastId = videoId;
    }
  }
  return lastId;
}

function assignVideos(ctx) {
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

  const globallyAvailable = candidates.filter(
    (v) => !windowClaims.has(v.id) && !recentGlobalCooldown.has(v.id),
  );

  const results = [];
  const incrementalUsage = new Map();

  for (let ai = 0; ai < accountIds.length; ai++) {
    const accountId = accountIds[ai];
    const posted = getPostedSet(usageByAccount, accountId);

    let perAccountPool = globallyAvailable.filter((v) => !posted.has(v.id));
    let isCycleReset = false;

    if (perAccountPool.length === 0 && globallyAvailable.length > 0) {
      isCycleReset = true;
      const lastVideo = getLastPostedVideo(usageByAccount, accountId);
      perAccountPool = globallyAvailable.filter((v) => v.id !== lastVideo);
      if (perAccountPool.length === 0) {
        perAccountPool = globallyAvailable;
      }
    }

    const effectiveGlobalUsage = new Map(globalUsage);
    for (const [vid, inc] of incrementalUsage) {
      effectiveGlobalUsage.set(
        vid,
        (effectiveGlobalUsage.get(vid) ?? 0) + inc,
      );
    }

    const ranked = buildRankedPool(
      perAccountPool,
      strategy,
      effectiveGlobalUsage,
      rng,
    );

    if (ranked.length === 0) continue;

    const index = ai % ranked.length;
    const selected = ranked[index];
    results.push({ accountId, video: selected, isCycleReset });

    incrementalUsage.set(
      selected.id,
      (incrementalUsage.get(selected.id) ?? 0) + 1,
    );
  }

  return results;
}

// ---------------------------------------------------------------------------
// CLI argument parsing
// ---------------------------------------------------------------------------
function parseArgs(argv) {
  const args = {
    accounts: 5,
    videos: 10,
    rounds: 3,
    strategy: "views",
    seed: "simulation-42",
  };
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--accounts" && argv[i + 1]) args.accounts = parseInt(argv[++i], 10);
    else if (arg === "--videos" && argv[i + 1]) args.videos = parseInt(argv[++i], 10);
    else if (arg === "--rounds" && argv[i + 1]) args.rounds = parseInt(argv[++i], 10);
    else if (arg === "--strategy" && argv[i + 1]) args.strategy = argv[++i];
    else if (arg === "--seed" && argv[i + 1]) args.seed = argv[++i];
  }
  return args;
}

// ---------------------------------------------------------------------------
// Simulation runner
// ---------------------------------------------------------------------------
function runSimulation(config) {
  const { accounts: numAccounts, videos: numVideos, rounds, strategy, seed } = config;

  // Generate test data
  const accountIds = Array.from({ length: numAccounts }, (_, i) => `account-${i + 1}`);
  const candidates = Array.from({ length: numVideos }, (_, i) => ({
    id: `video-${i + 1}`,
    views: Math.floor(Math.random() * 100000) + 1000,
    public_url: `https://example.com/video-${i + 1}.mp4`,
    caption: `Video ${i + 1}`,
  }));

  // Sort candidates by views DESC for display
  const sortedByViews = candidates.slice().sort((a, b) => b.views - a.views);

  console.log(`\n${"=".repeat(80)}`);
  console.log(`SIMULATION: ${numAccounts} accounts × ${numVideos} videos × ${rounds} rounds`);
  console.log(`Strategy: ${strategy} | Seed: ${seed}`);
  console.log(`${"=".repeat(80)}\n`);

  // Display video pool ranked by views
  console.log("VIDEO POOL (sorted by views):");
  console.log("-".repeat(50));
  sortedByViews.forEach((v, i) => {
    console.log(`  ${(i + 1).toString().padStart(2)}. ${v.id.padEnd(10)} — ${v.views.toLocaleString().padStart(8)} views`);
  });
  console.log();

  // Run rounds
  const usageByAccount = new Map();
  for (const accId of accountIds) {
    usageByAccount.set(accId, new Map());
  }

  const allAssignments = [];
  let totalCollisions = 0;
  let totalPossibleCollisions = 0;

  for (let round = 0; round < rounds; round++) {
    const roundSeed = `${seed}:round-${round}`;
    const assignments = assignVideos({
      candidates,
      accountIds,
      usageByAccount,
      windowClaims: new Set(),
      recentGlobalCooldown: new Set(),
      strategy,
      seed: roundSeed,
    });

    allAssignments.push(assignments);

    // Count collisions in this round
    const videoCounts = new Map();
    for (const a of assignments) {
      videoCounts.set(a.video.id, (videoCounts.get(a.video.id) ?? 0) + 1);
    }
    const collisionsThisRound = assignments.length - videoCounts.size;
    totalCollisions += collisionsThisRound;
    totalPossibleCollisions += Math.max(0, numAccounts - numVideos);

    // Update usage for next round
    for (const a of assignments) {
      const videoMap = usageByAccount.get(a.accountId);
      videoMap.set(a.video.id, (videoMap.get(a.video.id) ?? 0) + 1);
    }

    // Display round results
    console.log(`ROUND ${round + 1}:`);
    console.log("-".repeat(60));
    for (const a of assignments) {
      const resetMark = a.isCycleReset ? " [RESET]" : "";
      console.log(
        `  ${a.accountId.padEnd(12)} → ${a.video.id.padEnd(10)} (${a.video.views.toLocaleString().padStart(8)} views)${resetMark}`,
      );
    }
    const uniqueVideos = videoCounts.size;
    console.log(
      `  Unique videos: ${uniqueVideos}/${assignments.length} | Collisions: ${collisionsThisRound}`,
    );
    console.log();
  }

  // Summary
  console.log(`${"=".repeat(80)}`);
  console.log("SUMMARY:");
  console.log("-".repeat(40));

  // Per-video usage across all rounds
  const globalVideoUsage = new Map();
  for (const roundAssignments of allAssignments) {
    for (const a of roundAssignments) {
      globalVideoUsage.set(a.video.id, (globalVideoUsage.get(a.video.id) ?? 0) + 1);
    }
  }

  console.log("\nPer-video total usage:");
  const sortedUsage = [...globalVideoUsage.entries()].sort((a, b) => b[1] - a[1]);
  for (const [videoId, count] of sortedUsage) {
    const video = candidates.find((v) => v.id === videoId);
    console.log(
      `  ${videoId.padEnd(10)} — used ${count}x (${video?.views.toLocaleString() ?? "?"} views)`,
    );
  }

  // Per-account usage distribution
  console.log("\nPer-account posts created:");
  for (const accId of accountIds) {
    const videoMap = usageByAccount.get(accId);
    const totalPosts = [...videoMap.values()].reduce((sum, c) => sum + c, 0);
    const uniqueVideos = videoMap.size;
    console.log(
      `  ${accId.padEnd(12)} — ${totalPosts} posts, ${uniqueVideos} unique videos`,
    );
  }

  console.log(
    `\nTotal collisions: ${totalCollisions} (expected minimum when M<N: ${totalPossibleCollisions})`,
  );
  console.log(`${"=".repeat(80)}\n`);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
const config = parseArgs(process.argv);
runSimulation(config);