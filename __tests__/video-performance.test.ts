import { describe, it, expect } from "vitest";
import { classifyPerformance } from "../lib/video-performance";
import { assignVideos, type PriorityContext, type VideoCandidate } from "../lib/media-priority";

function makeVideo(id: string, views: number): VideoCandidate {
  return { id, views, public_url: `https://example.com/${id}.mp4`, caption: null };
}

function ctx(overrides: Partial<PriorityContext>): PriorityContext {
  return {
    candidates: [],
    accountIds: [],
    usageByAccount: new Map(),
    windowClaims: new Set(),
    recentGlobalCooldown: new Set(),
    strategy: "views",
    seed: "perf-seed",
    ...overrides,
  };
}

describe("classifyPerformance", () => {
  // Formato medido em produção (2026-10-19): base ~170, mortos ~14, vencedor 3.600.
  const samples = new Map<string, number[]>([
    ["normal-a", [176, 182, 158, 153, 164]],
    ["normal-b", [196, 207, 207, 212, 306]],
    ["dead", [4, 8, 9, 9, 11, 19, 22]],
    ["mostly-dead", [5, 5, 9, 14, 20, 206]],
    ["winner", [3600, 2558, 14, 17]],
    ["two-copies-low", [3, 5]],
  ]);
  const tiers = classifyPerformance(samples);

  it("marca como morto o vídeo que a Meta não entrega em nenhuma conta", () => {
    expect(tiers.get("dead")).toBe("dead");
    expect(tiers.get("mostly-dead")).toBe("dead");
  });

  it("marca como vencedor o vídeo que estourou em alguma conta", () => {
    expect(tiers.get("winner")).toBe("winner");
  });

  it("não declara morto com menos de 3 cópias maduras", () => {
    expect(tiers.get("two-copies-low")).toBe("normal");
  });

  it("vídeos na base ficam normais", () => {
    expect(tiers.get("normal-a")).toBe("normal");
    expect(tiers.get("normal-b")).toBe("normal");
  });

  it("sem cópias suficientes no total, não classifica nada", () => {
    expect(classifyPerformance(new Map([["a", [1, 2, 3]], ["b", [200]]])).size).toBe(0);
  });

  it("é relativo à base: com contas maiores, 300 views não é morto", () => {
    const big = new Map<string, number[]>([
      ["base", [2000, 2100, 1900, 2200, 2050, 1950, 2000, 2100, 1900, 2000]],
      ["low", [300, 280, 310]],
      ["ok", [1500, 1600, 1700]],
    ]);
    const t = classifyPerformance(big);
    expect(t.get("low")).toBe("dead");
    expect(t.get("ok")).toBe("normal");
    // 5× a base (10.000) para ser vencedor; 2.200 não é.
    expect(t.get("base")).toBe("normal");
  });
});

describe("assignVideos com desempenho", () => {
  const accounts = ["a1", "a2", "a3", "a4"];
  const usage = new Map(accounts.map((a) => [a, new Map<string, number>()]));

  it("não atribui vídeo morto enquanto houver vídeos vivos suficientes", () => {
    const candidates = [
      makeVideo("dead1", 900_000), // mais views na origem, mas morto nas contas
      makeVideo("dead2", 800_000),
      makeVideo("v1", 50_000),
      makeVideo("v2", 40_000),
      makeVideo("v3", 30_000),
      makeVideo("v4", 20_000),
    ];
    const performanceTiers = new Map([
      ["dead1", "dead" as const],
      ["dead2", "dead" as const],
      ["v1", "normal" as const],
    ]);
    const res = assignVideos(ctx({
      candidates, accountIds: accounts, usageByAccount: usage, performanceTiers, videosPerAccount: 3,
    }));
    expect(res.length).toBe(12);
    expect(res.some((r) => r.video.id.startsWith("dead"))).toBe(false);
  });

  it("vencedor vem antes das views da origem na primeira rodada", () => {
    const candidates = [
      makeVideo("top-origem", 900_000),
      makeVideo("v2", 40_000),
      makeVideo("v3", 30_000),
      makeVideo("vencedor", 10_000),
    ];
    const performanceTiers = new Map([["vencedor", "winner" as const]]);
    const res = assignVideos(ctx({
      candidates, accountIds: ["a1"], usageByAccount: new Map([["a1", new Map()]]), performanceTiers,
    }));
    expect(res[0].video.id).toBe("vencedor");
  });

  it("com poucos vídeos vivos, mantém os mortos no pool (mas por último)", () => {
    const candidates = [
      makeVideo("dead1", 900_000),
      makeVideo("dead2", 800_000),
      makeVideo("v1", 10),
      makeVideo("v2", 5),
    ];
    const performanceTiers = new Map([
      ["dead1", "dead" as const],
      ["dead2", "dead" as const],
    ]);
    const res = assignVideos(ctx({
      candidates, accountIds: ["a1"], usageByAccount: new Map([["a1", new Map()]]),
      performanceTiers, videosPerAccount: 4,
    }));
    // Pool vivo (2) < mínimo (3): nada some, mas os vivos saem primeiro.
    expect(res.map((r) => r.video.id).slice(0, 2).sort()).toEqual(["v1", "v2"]);
    expect(res.length).toBe(4);
  });

  it("sem performanceTiers, o comportamento é o anterior", () => {
    const candidates = [makeVideo("x", 3), makeVideo("y", 2), makeVideo("z", 1)];
    const a = assignVideos(ctx({ candidates, accountIds: ["a1"], usageByAccount: new Map([["a1", new Map()]]) }));
    const b = assignVideos(ctx({
      candidates, accountIds: ["a1"], usageByAccount: new Map([["a1", new Map()]]), performanceTiers: new Map(),
    }));
    expect(a.map((r) => r.video.id)).toEqual(b.map((r) => r.video.id));
    expect(a[0].video.id).toBe("x");
  });
});
