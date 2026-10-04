import { describe, it, expect } from "vitest";
import {
  assignVideos,
  buildRankedPool,
  computeGlobalUsage,
  normalizePriorityStrategy,
  type PriorityContext,
  type VideoCandidate,
} from "../lib/media-priority";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeVideo(id: string, views: number): VideoCandidate {
  return { id, views, public_url: `https://example.com/${id}.mp4`, caption: null };
}

function emptyUsage(accountIds: string[]): Map<string, Map<string, number>> {
  const m = new Map<string, Map<string, number>>();
  for (const id of accountIds) m.set(id, new Map());
  return m;
}

function baseCtx(overrides: Partial<PriorityContext> = {}): PriorityContext {
  return {
    candidates: [],
    accountIds: [],
    usageByAccount: new Map(),
    windowClaims: new Set(),
    recentGlobalCooldown: new Set(),
    strategy: "views",
    seed: "test-seed",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("normalizePriorityStrategy", () => {
  it("returns valid strategies as-is", () => {
    expect(normalizePriorityStrategy("views")).toBe("views");
    expect(normalizePriorityStrategy("least_usage")).toBe("least_usage");
    expect(normalizePriorityStrategy("random")).toBe("random");
  });

  it("defaults to least_usage for invalid/missing values", () => {
    expect(normalizePriorityStrategy(undefined)).toBe("least_usage");
    expect(normalizePriorityStrategy(null)).toBe("least_usage");
    expect(normalizePriorityStrategy("")).toBe("least_usage");
    expect(normalizePriorityStrategy("invalid")).toBe("least_usage");
  });
});

describe("computeGlobalUsage", () => {
  it("aggregates usage across accounts", () => {
    const usage = new Map<string, Map<string, number>>();
    usage.set("a1", new Map([["v1", 2], ["v2", 1]]));
    usage.set("a2", new Map([["v1", 3], ["v3", 1]]));

    const global = computeGlobalUsage(usage);
    expect(global.get("v1")).toBe(5);
    expect(global.get("v2")).toBe(1);
    expect(global.get("v3")).toBe(1);
  });

  it("returns empty map for empty input", () => {
    expect(computeGlobalUsage(new Map()).size).toBe(0);
  });
});

describe("buildRankedPool", () => {
  const rng = () => 0.5; // deterministic

  it("sorts by views DESC in views mode", () => {
    const candidates = [makeVideo("v1", 100), makeVideo("v2", 500), makeVideo("v3", 300)];
    const pool = buildRankedPool(candidates, "views", new Map(), rng);
    expect(pool.map((v) => v.id)).toEqual(["v2", "v3", "v1"]);
  });

  it("tiebreaks by least global usage in views mode", () => {
    const candidates = [makeVideo("v1", 100), makeVideo("v2", 100)];
    const globalUsage = new Map([["v1", 5], ["v2", 1]]);
    const pool = buildRankedPool(candidates, "views", globalUsage, rng);
    expect(pool[0].id).toBe("v2"); // less used comes first
  });

  it("sorts by least usage ASC in least_usage mode", () => {
    const candidates = [makeVideo("v1", 999), makeVideo("v2", 1)];
    const globalUsage = new Map([["v1", 0], ["v2", 10]]);
    const pool = buildRankedPool(candidates, "least_usage", globalUsage, rng);
    expect(pool[0].id).toBe("v1"); // least used first regardless of views
  });

  it("returns empty array for empty candidates", () => {
    expect(buildRankedPool([], "views", new Map(), rng)).toEqual([]);
  });
});

describe("assignVideos", () => {
  it("returns empty for no accounts or no candidates", () => {
    expect(assignVideos(baseCtx({ candidates: [makeVideo("v1", 100)] })).length).toBe(0);
    expect(assignVideos(baseCtx({ accountIds: ["a1"] })).length).toBe(0);
  });

  it("assigns top-viewed videos first without repetition when M >= N", () => {
    const accounts = ["a1", "a2", "a3"];
    const videos = [
      makeVideo("v1", 1000),
      makeVideo("v2", 800),
      makeVideo("v3", 600),
      makeVideo("v4", 400),
    ];

    const result = assignVideos(
      baseCtx({
        candidates: videos,
        accountIds: accounts,
        usageByAccount: emptyUsage(accounts),
        strategy: "views",
        seed: "test-1",
      }),
    );

    expect(result.length).toBe(3);
    const assignedIds = result.map((r) => r.video.id);
    // All different videos
    expect(new Set(assignedIds).size).toBe(3);
    // Top 3 by views should be assigned (v1, v2, v3)
    expect(assignedIds.sort()).toEqual(["v1", "v2", "v3"].sort());
  });

  it("distributes evenly when M < N (10 accounts / 3 videos → 4/3/3)", () => {
    const accounts = Array.from({ length: 10 }, (_, i) => `a${i + 1}`);
    const videos = [makeVideo("v1", 1000), makeVideo("v2", 800), makeVideo("v3", 600)];

    const result = assignVideos(
      baseCtx({
        candidates: videos,
        accountIds: accounts,
        usageByAccount: emptyUsage(accounts),
        strategy: "views",
        seed: "scarcity-test",
      }),
    );

    expect(result.length).toBe(10);

    const counts = new Map<string, number>();
    for (const r of result) {
      counts.set(r.video.id, (counts.get(r.video.id) ?? 0) + 1);
    }

    const distribution = [...counts.values()].sort((a, b) => b - a);
    expect(distribution).toEqual([4, 3, 3]);
  });

  it("produces identical results with the same seed", () => {
    const accounts = ["a1", "a2", "a3", "a4", "a5"];
    const videos = Array.from({ length: 10 }, (_, i) => makeVideo(`v${i + 1}`, (i + 1) * 100));
    const usage = emptyUsage(accounts);

    const ctx = baseCtx({
      candidates: videos,
      accountIds: accounts,
      usageByAccount: usage,
      strategy: "views",
      seed: "determinism-test",
    });

    const run1 = assignVideos(ctx);
    const run2 = assignVideos(ctx);

    expect(run1.map((r) => `${r.accountId}:${r.video.id}`)).toEqual(
      run2.map((r) => `${r.accountId}:${r.video.id}`),
    );
  });

  it("excludes videos in windowClaims and recentGlobalCooldown", () => {
    const accounts = ["a1", "a2"];
    const videos = [
      makeVideo("v1", 1000),
      makeVideo("v2", 800),
      makeVideo("v3", 600),
    ];

    const result = assignVideos(
      baseCtx({
        candidates: videos,
        accountIds: accounts,
        usageByAccount: emptyUsage(accounts),
        windowClaims: new Set(["v1"]),
        recentGlobalCooldown: new Set(["v2"]),
        strategy: "views",
        seed: "exclusion-test",
      }),
    );

    // Only v3 is available, both accounts get it
    expect(result.length).toBe(2);
    expect(result.every((r) => r.video.id === "v3")).toBe(true);
  });

  it("respects per-account history — skips already-posted videos", () => {
    const accounts = ["a1", "a2"];
    const videos = [makeVideo("v1", 1000), makeVideo("v2", 800), makeVideo("v3", 600)];

    const usage = new Map<string, Map<string, number>>();
    usage.set("a1", new Map([["v1", 1]])); // a1 already posted v1
    usage.set("a2", new Map());

    const result = assignVideos(
      baseCtx({
        candidates: videos,
        accountIds: accounts,
        usageByAccount: usage,
        strategy: "views",
        seed: "history-test",
      }),
    );

    // a1 should NOT get v1 (already posted), should get v2 (next best)
    const a1Result = result.find((r) => r.accountId === "a1");
    expect(a1Result?.video.id).not.toBe("v1");
  });

  it("handles cycle reset when personal pool is exhausted", () => {
    const accounts = ["a1"];
    const videos = [makeVideo("v1", 1000)];

    const usage = new Map<string, Map<string, number>>();
    usage.set("a1", new Map([["v1", 5]])); // a1 has posted v1 many times

    const result = assignVideos(
      baseCtx({
        candidates: videos,
        accountIds: accounts,
        usageByAccount: usage,
        strategy: "views",
        seed: "cycle-reset-test",
      }),
    );

    // Should still assign something via cycle reset
    expect(result.length).toBe(1);
    expect(result[0].isCycleReset).toBe(true);
  });
});