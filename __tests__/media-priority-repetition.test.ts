import { describe, it, expect } from "vitest";
import { assignVideos, type VideoCandidate } from "../lib/media-priority";

/**
 * Regressão: campanha de distribuição com contas que já esgotaram (ou quase)
 * a pasta. No reset de ciclo o pool era reordenado só por views — a conta
 * recebia o mesmo top-2 alternado (A, B, A, B…) e, no cron de sincronização,
 * o "último vídeo" era inferido pelo maior contador, deixando o mesmo vídeo
 * sair duas vezes seguidas.
 */

function makeVideos(n: number): VideoCandidate[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `v${String(i + 1).padStart(3, "0")}`,
    views: (n - i) * 1000,
    public_url: `https://example.com/v${i + 1}.mp4`,
    caption: null,
  }));
}

function sequenceByAccount(results: { accountId: string; video: VideoCandidate }[]) {
  const seq = new Map<string, string[]>();
  for (const r of results) {
    const list = seq.get(r.accountId) ?? [];
    list.push(r.video.id);
    seq.set(r.accountId, list);
  }
  return seq;
}

function maxRepeat(list: string[]): number {
  const counts = new Map<string, number>();
  for (const id of list) counts.set(id, (counts.get(id) ?? 0) + 1);
  return Math.max(...counts.values());
}

function minGapBetweenRepeats(list: string[]): number {
  const lastIdx = new Map<string, number>();
  let minGap = Infinity;
  list.forEach((id, i) => {
    const prev = lastIdx.get(id);
    if (prev !== undefined) minGap = Math.min(minGap, i - prev);
    lastIdx.set(id, i);
  });
  return minGap;
}

describe("Distribuição — contas que já postaram quase toda a pasta", () => {
  for (const strategy of ["views", "least_usage", "random"] as const) {
    it(`[${strategy}] lote inteiro não fica preso aos vídeos de maior views`, () => {
      const videos = makeVideos(30);
      const accounts = ["a1", "a2", "a3"];
      // Cada conta já postou 25 dos 30 vídeos (campanhas/loops anteriores).
      const usage = new Map<string, Map<string, number>>();
      accounts.forEach((acc, ai) => {
        const m = new Map<string, number>();
        for (let i = 0; i < 25; i++) m.set(videos[(i + ai * 3) % 30].id, 1);
        usage.set(acc, m);
      });

      const result = assignVideos({
        candidates: videos,
        accountIds: accounts,
        usageByAccount: usage,
        windowClaims: new Set(),
        recentGlobalCooldown: new Set(),
        strategy,
        seed: `distribute-exhausted-${strategy}`,
        videosPerAccount: 30, // video_count = todos
      });

      const seq = sequenceByAccount(result);
      for (const acc of accounts) {
        const list = seq.get(acc)!;
        expect(list).toHaveLength(30);
        // 30 posts com 30 vídeos na pasta: cada vídeo no máximo 2× no lote
        // (5 inéditos + 25 já postados, rodando a pasta inteira de novo).
        expect(maxRepeat(list)).toBeLessThanOrEqual(2);
        // Nunca o mesmo vídeo em sequência nem "quase" em sequência.
        expect(minGapBetweenRepeats(list)).toBeGreaterThanOrEqual(10);
      }
    });
  }

  it("conta já com histórico completo: segundo ciclo percorre a pasta inteira antes de repetir", () => {
    const videos = makeVideos(20);
    const usage = new Map([["a1", new Map(videos.map((v) => [v.id, 1]))]]);

    const result = assignVideos({
      candidates: videos,
      accountIds: ["a1"],
      usageByAccount: usage,
      windowClaims: new Set(),
      recentGlobalCooldown: new Set(),
      strategy: "views",
      seed: "full-cycle",
      videosPerAccount: 20,
    });

    const list = result.map((r) => r.video.id);
    expect(new Set(list).size).toBe(20);
  });
});

describe("Sync cron — 1 vídeo por ciclo com seed persistida da campanha", () => {
  it("nunca repete o vídeo imediatamente anterior nem fica alternando entre 2", () => {
    const videos = makeVideos(15);
    // Conta já rodou a pasta inteira 1× — a ordem real de postagem é
    // diferente da ordem lexicográfica dos ids.
    const counts = new Map(videos.map((v) => [v.id, 1]));
    const history: string[] = videos.map((v) => v.id).reverse();

    const posted: string[] = [];
    for (let cycle = 0; cycle < 30; cycle++) {
      const result = assignVideos({
        candidates: videos,
        accountIds: ["a1"],
        usageByAccount: new Map([["a1", new Map(counts)]]),
        windowClaims: new Set(),
        recentGlobalCooldown: new Set(),
        strategy: "views",
        seed: "persisted-campaign-seed",
        videosPerAccount: 1,
        recentByAccount: new Map([["a1", history.slice(-12).reverse()]]),
      });
      expect(result).toHaveLength(1);
      const id = result[0].video.id;
      posted.push(id);
      history.push(id);
      counts.set(id, (counts.get(id) ?? 0) + 1);
    }

    // 30 ciclos com 15 vídeos → cada vídeo exatamente 2×, um ciclo completo
    // da pasta antes de repetir qualquer um.
    expect(maxRepeat(posted)).toBe(2);
    expect(new Set(posted.slice(0, 15)).size).toBe(15);
    expect(new Set(posted.slice(15)).size).toBe(15);
    // Cooldown = min(12, metade do pool) = 7 → repetição só depois de 8 posts.
    expect(minGapBetweenRepeats(posted)).toBeGreaterThanOrEqual(8);
  });
});

describe("Diversidade entre contas no mesmo lote", () => {
  it("contas sem histórico não postam a mesma sequência deslocada de 1 slot", () => {
    const videos = makeVideos(40);
    const accounts = ["a1", "a2", "a3", "a4"];
    const result = assignVideos({
      candidates: videos,
      accountIds: accounts,
      usageByAccount: new Map(),
      windowClaims: new Set(),
      recentGlobalCooldown: new Set(),
      strategy: "views",
      seed: "cross-account",
      videosPerAccount: 10,
    });

    // Dentro do lote, cada vídeo deve sair em no máximo 1 conta enquanto houver
    // inéditos suficientes (40 vídeos ≥ 4 contas × 10 posts).
    const counts = new Map<string, number>();
    for (const r of result) counts.set(r.video.id, (counts.get(r.video.id) ?? 0) + 1);
    expect(Math.max(...counts.values())).toBe(1);
  });
});
