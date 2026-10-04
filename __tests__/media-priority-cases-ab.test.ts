import { describe, it, expect } from "vitest";
import { assignVideos } from "../lib/media-priority";

/**
 * P1: Testes para os Casos A e B descritos no prompt complementar.
 * Esses testes falham no comportamento guloso anterior e passam com o matching bipartido.
 */

describe("Caso A: existe atribuição sem repetição, mas seleção gulosa reinicia ciclos", () => {
  it("deve encontrar matching perfeito A→v2, B→v1, C→v3 sem reset de ciclo", () => {
    const candidates = [
      { id: "v1", views: 900, public_url: "url1", caption: null },
      { id: "v2", views: 800, public_url: "url2", caption: null },
      { id: "v3", views: 700, public_url: "url3", caption: null },
    ];
    const accountIds = ["A", "B", "C"];
    // Histórico: A usou v3, B usou v2 e v3, C usou v1 e v2
    const usageByAccount = new Map([
      ["A", new Map([["v3", 1]])],
      ["B", new Map([["v2", 1], ["v3", 1]])],
      ["C", new Map([["v1", 1], ["v2", 1]])],
    ]);

    const result = assignVideos({
      candidates,
      accountIds,
      usageByAccount,
      windowClaims: new Set(),
      recentGlobalCooldown: new Set(),
      strategy: "views",
      seed: "review-0",
      videosPerAccount: 1,
    });

    expect(result).toHaveLength(3);
    // Verifica que não houve reset de ciclo (todas as contas receberam vídeo inédito)
    const resets = result.filter(r => r.isCycleReset);
    expect(resets).toHaveLength(0);

    // Verifica atribuições específicas: A→v2, B→v1, C→v3
    const assignmentMap = new Map(result.map(r => [r.accountId, r.video.id]));
    expect(assignmentMap.get("A")).toBe("v2");
    expect(assignmentMap.get("B")).toBe("v1");
    expect(assignmentMap.get("C")).toBe("v3");
  });
});

describe("Caso B: escassez ignora histórico individual", () => {
  it("deve respeitar elegibilidade individual mesmo em escassez (3 contas, 2 vídeos)", () => {
    const candidates = [
      { id: "v1", views: 900, public_url: "url1", caption: null },
      { id: "v2", views: 800, public_url: "url2", caption: null },
    ];
    const accountIds = ["A", "B", "C"];
    // Todas as contas já usaram v1; nenhuma usou v2
    const usageByAccount = new Map([
      ["A", new Map([["v1", 1]])],
      ["B", new Map([["v1", 1]])],
      ["C", new Map([["v1", 1]])],
    ]);

    const result = assignVideos({
      candidates,
      accountIds,
      usageByAccount,
      windowClaims: new Set(),
      recentGlobalCooldown: new Set(),
      strategy: "views",
      seed: "scarcity-review",
      videosPerAccount: 1,
    });

    expect(result).toHaveLength(3);
    // Em escassez, pelo menos uma conta deve receber v2 (inédito para todas)
    // O matching deve priorizar elegibilidade antes de distribuição modular
    const v2Assignments = result.filter(r => r.video.id === "v2");
    expect(v2Assignments.length).toBeGreaterThanOrEqual(1);

    // Contas que recebem v1 devem ter isCycleReset=true (já usaram antes)
    const v1Assignments = result.filter(r => r.video.id === "v1");
    for (const assignment of v1Assignments) {
      expect(assignment.isCycleReset).toBe(true);
    }
  });
});

describe("Reprodutibilidade com seed fixa", () => {
  it("mesma seed e estado produzem mesma atribuição", () => {
    const candidates = [
      { id: "v1", views: 900, public_url: "url1", caption: null },
      { id: "v2", views: 800, public_url: "url2", caption: null },
      { id: "v3", views: 700, public_url: "url3", caption: null },
    ];
    const accountIds = ["A", "B", "C"];
    const usageByAccount = new Map([
      ["A", new Map()],
      ["B", new Map()],
      ["C", new Map()],
    ]);

    const result1 = assignVideos({
      candidates,
      accountIds,
      usageByAccount,
      windowClaims: new Set(),
      recentGlobalCooldown: new Set(),
      strategy: "views",
      seed: "fixed-seed-123",
      videosPerAccount: 1,
    });

    const result2 = assignVideos({
      candidates,
      accountIds,
      usageByAccount,
      windowClaims: new Set(),
      recentGlobalCooldown: new Set(),
      strategy: "views",
      seed: "fixed-seed-123",
      videosPerAccount: 1,
    });

    expect(result1).toEqual(result2);
  });
});