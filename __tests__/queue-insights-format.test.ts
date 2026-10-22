import { describe, it, expect } from "vitest";
import { fmtInt, fmtViews, plural } from "../components/dashboard/queue-insights/format";
import { idealHandoff, republishHandoff } from "../components/dashboard/queue-insights/handoff-payload";
import { pickQueueKey } from "../components/dashboard/queue-insights/useQueueInsights";
import type { QueueInsightsResponse } from "../lib/queue-insights/types";

const NOW = new Date("2026-10-21T15:00:00Z");
const plus = (min: number) => new Date(NOW.getTime() + min * 60_000).toISOString();

const HANDOFF_DEFAULTS = {
  folderId: "folder-1",
  captionMode: "original" as const,
  captions: [],
  autoCaptionType: null,
  stripHashtags: false,
  stripMentions: false,
  videoProcessingMode: "original",
  shareToFeed: true,
  useProxyPool: false,
  accountStaggerSeconds: null,
};

function response(over: Partial<QueueInsightsResponse> = {}): QueueInsightsResponse {
  return {
    queue: {
      source: "postar",
      id: "q1",
      label: "Postar · pasta Cortes · 12 contas · desde 01/10",
      state: "running",
      accountCount: 12,
      intervalMinutes: 60,
      burstMode: false,
      publishedLast24h: 200,
      createdAt: "2026-10-01T12:00:00Z",
      folderId: "folder-1",
      folderName: "Cortes",
      folderVideoIds: ["v1", "v2", "v3"],
      accountIds: ["a1", "a2", "a3"],
      videoCountCap: -1,
      postsPerDay: 24,
      handoff: HANDOFF_DEFAULTS,
    },
    generatedAt: NOW.toISOString(),
    summary: { since: "2026-10-01T12:00:00Z", posts: 10, totalViews: 1000, viewsPerPost: 100, bestPostViews: 400 },
    hot: {
      postId: "p1",
      source: "postar",
      accountId: "a1",
      username: "conta1",
      avatarUrl: null,
      videoId: "v2",
      publicUrl: "https://cdn/v2.mp4",
      mediaId: "m1",
      views: 400,
      publishedAt: "2026-10-21T10:00:00Z",
      videoTypicalViews: 200,
      republishAccountIds: ["a2", "a3"],
      eyebrow: "400 views em 21/10 às 07h",
      title: "Um post seu está indo muito bem agora",
      body: "…",
    },
    ideal: {
      videos: [
        { videoId: "v1", publicUrl: "https://cdn/v1.mp4", caption: "um", avgViews: 300, posts: 4, accounts: 4 },
        { videoId: "v2", publicUrl: null, caption: "dois", avgViews: 200, posts: 3, accounts: 3 },
      ],
      accounts: [
        { accountId: "a3", username: "conta3", avatarUrl: null, avgViews: 250, posts: 5 },
        { accountId: "a1", username: "conta1", avatarUrl: null, avgViews: 150, posts: 4 },
      ],
      postsPerCycle: 4,
      intervalMinutes: 60,
      postsPerDay: 24,
      expectedPerPost: 220,
      medianPerPost: 80,
      bestHour: 19,
      bestHourViews: 300,
      patternDay: null,
      startAt: plus(120),
      eyebrow: "~220 views por publicação",
      title: "A sua fila ideal, montada com o que já funciona",
      body: "…",
      footnote: "Refeita toda vez que você abre o Raio-X, com os números mais recentes. Dá para mudar tudo antes de publicar.",
    },
    idealUnavailable: null,
    ...over,
  };
}

describe("Raio-X — números (format.ts)", () => {
  it("fmtInt escreve o número inteiro em pt-BR, sem compactar", () => {
    expect(fmtInt(2080527)).toBe("2.080.527");
    expect(fmtInt(1234)).toBe("1.234");
    expect(fmtInt(867.6)).toBe("868");
    expect(fmtInt(0)).toBe("0");
    expect(fmtInt(null)).toBe("—");
    expect(fmtInt(NaN)).toBe("—");
  });

  it("plural e fmtViews concordam com o número", () => {
    expect(plural(1, "post", "posts")).toBe("1 post");
    expect(plural(3, "post", "posts")).toBe("3 posts");
    expect(fmtViews(108834)).toBe("108.834 views");
    expect(fmtViews(1)).toBe("1 view");
    expect(fmtViews(null)).toBe("— views");
  });
});

describe("Raio-X — botões → Postar (handoff-payload.ts)", () => {
  it("Montar essa fila leva vídeos e contas na ordem da fila ideal, com o ritmo e o início sugerido", () => {
    const p = idealHandoff(response(), NOW)!;
    expect(p.kind).toBe("ideal");
    expect(p.videoIds).toEqual(["v1", "v2"]);
    expect(p.accountIds).toEqual(["a3", "a1"]);
    expect(p.postsPerDay).toBe(24);
    expect(p.startAt).toBe(plus(120));
    expect(p.defaults).toEqual(HANDOFF_DEFAULTS);
    expect(p.sourceQueue).toEqual({ source: "postar", id: "q1", label: "Postar · pasta Cortes · 12 contas · desde 01/10" });
    expect(p.videos).toEqual([
      { id: "v1", publicUrl: "https://cdn/v1.mp4", caption: "um" },
      { id: "v2", publicUrl: null, caption: "dois" },
    ]);
  });

  it("início sugerido que já passou (ou está a menos de 5 min) vira agora + 5 min", () => {
    const base = response();
    const past = response({ ideal: { ...base.ideal!, startAt: plus(-30) } });
    expect(idealHandoff(past, NOW)!.startAt).toBe(plus(5));
    const soon = response({ ideal: { ...base.ideal!, startAt: plus(2) } });
    expect(idealHandoff(soon, NOW)!.startAt).toBe(plus(5));
  });

  it("sem fila ideal (ou sem contas) não monta nada", () => {
    expect(idealHandoff(response({ ideal: null, idealUnavailable: "motivo" }), NOW)).toBeNull();
    const base = response();
    expect(idealHandoff(response({ ideal: { ...base.ideal!, accounts: [] } }), NOW)).toBeNull();
  });

  it("Publicar nas outras contas: 1 vídeo, contas que nunca postaram, em 5 min, 5 min entre contas", () => {
    const p = republishHandoff(response(), NOW)!;
    expect(p.kind).toBe("republish");
    expect(p.videoIds).toEqual(["v2"]);
    expect(p.accountIds).toEqual(["a2", "a3"]);
    expect(p.postsPerDay).toBe(1);
    expect(p.startAt).toBe(plus(5));
    expect(p.defaults).toEqual({ ...HANDOFF_DEFAULTS, accountStaggerSeconds: 300 });
    // URL do post quente; legenda emprestada da fila ideal quando o vídeo está nela.
    expect(p.videos).toEqual([{ id: "v2", publicUrl: "https://cdn/v2.mp4", caption: "dois" }]);
  });

  it("Publicar nas outras contas não monta nada sem vídeo ou sem conta livre", () => {
    const base = response();
    expect(republishHandoff(response({ hot: null }), NOW)).toBeNull();
    expect(republishHandoff(response({ hot: { ...base.hot!, videoId: null } }), NOW)).toBeNull();
    expect(republishHandoff(response({ hot: { ...base.hot!, republishAccountIds: [] } }), NOW)).toBeNull();
  });
});

describe("Raio-X — fila em que o painel abre (pickQueueKey)", () => {
  const queues = [
    { source: "postar" as const, id: "q1" },
    { source: "loop" as const, id: "l1" },
  ];

  it("a escolhida pelo dono, se ainda está rodando; senão a sugerida; senão a primeira", () => {
    expect(pickQueueKey(queues, "loop:l1", { source: "postar", id: "q1" })).toBe("loop:l1");
    expect(pickQueueKey(queues, "postar:sumiu", { source: "loop", id: "l1" })).toBe("loop:l1");
    expect(pickQueueKey(queues, null, { source: "postar", id: "sumiu" })).toBe("postar:q1");
    expect(pickQueueKey([], "loop:l1", null)).toBeNull();
  });
});
