import { describe, it, expect } from "vitest";
import {
  aggregateFila,
  filterFilaVideos,
  isBelowAverage,
  pickSwapTarget,
  sortFilaVideos,
  type FilaVideoInput,
} from "../lib/fila/stats";
import type { FilaVideo } from "../lib/fila/types";

function input(id: string, extra: Partial<FilaVideoInput> = {}): FilaVideoInput {
  return { id, publicUrl: null, caption: null, createdAt: "2026-10-20T12:00:00.000Z", pausedAt: null, ...extra };
}

function video(id: string, posts: number, views: number, extra: Partial<FilaVideo> = {}): FilaVideo {
  return {
    id,
    publicUrl: null,
    caption: null,
    createdAt: "2026-10-20T12:00:00.000Z",
    posts,
    views,
    avgViews: posts > 0 ? views / posts : null,
    pausedAt: null,
    ...extra,
  };
}

describe("aggregateFila", () => {
  it("soma posts e views por vídeo e calcula a média simples (views ÷ posts)", () => {
    const { videos, summary } = aggregateFila(
      [input("a"), input("b"), input("c")],
      [
        { videoId: "a", views: 1000 },
        { videoId: "a", views: 500 },
        { videoId: "b", views: 90 },
        { videoId: "a", views: null }, // ainda sem leitura: entra com 0
      ],
    );
    const a = videos.find((v) => v.id === "a")!;
    expect(a.posts).toBe(3);
    expect(a.views).toBe(1500);
    expect(a.avgViews).toBe(500);
    expect(videos.find((v) => v.id === "c")).toMatchObject({ posts: 0, views: 0, avgViews: null });
    expect(summary).toEqual({ posts: 4, views: 1590, avgViews: 397.5, videos: 3, paused: 0 });
  });

  it("o resumo conta post de vídeo que já saiu da pasta; a linha só existe para vídeo da pasta", () => {
    const { videos, summary } = aggregateFila([input("a")], [
      { videoId: "a", views: 100 },
      { videoId: "fora", views: 300 },
      { videoId: null, views: 50 },
    ]);
    expect(videos).toHaveLength(1);
    expect(videos[0]).toMatchObject({ posts: 1, views: 100 });
    expect(summary.posts).toBe(3);
    expect(summary.views).toBe(450);
    expect(summary.avgViews).toBe(150);
  });

  it("conta os pausados e não tem média sem posts", () => {
    const { summary } = aggregateFila([input("a", { pausedAt: "2026-10-22T10:00:00.000Z" }), input("b")], []);
    expect(summary).toEqual({ posts: 0, views: 0, avgViews: null, videos: 2, paused: 1 });
  });

  it("view negativa ou inválida conta como 0", () => {
    const { videos } = aggregateFila([input("a")], [
      { videoId: "a", views: -5 },
      { videoId: "a", views: Number.NaN },
      { videoId: "a", views: 10 },
    ]);
    expect(videos[0]).toMatchObject({ posts: 3, views: 10 });
  });
});

describe("isBelowAverage", () => {
  it("só marca com média dos dois lados", () => {
    expect(isBelowAverage({ avgViews: 100 }, 254)).toBe(true);
    expect(isBelowAverage({ avgViews: 254 }, 254)).toBe(false);
    expect(isBelowAverage({ avgViews: null }, 254)).toBe(false);
    expect(isBelowAverage({ avgViews: 10 }, null)).toBe(false);
  });
});

describe("sortFilaVideos", () => {
  const list = [
    video("alto", 10, 20000),
    video("baixo", 10, 500),
    video("medio", 40, 8000), // média 200
    video("novo", 0, 0, { createdAt: "2026-10-22T12:00:00.000Z" }),
    video("velho", 0, 0, { createdAt: "2026-10-01T12:00:00.000Z" }),
  ];

  it("menos views primeiro, vídeos sem post sempre no fim (mais novo antes)", () => {
    expect(sortFilaVideos(list, "views_asc").map((v) => v.id)).toEqual(["baixo", "medio", "alto", "novo", "velho"]);
  });

  it("mais views primeiro", () => {
    expect(sortFilaVideos(list, "views_desc").map((v) => v.id)).toEqual(["alto", "medio", "baixo", "novo", "velho"]);
  });

  it("por média e por posts", () => {
    expect(sortFilaVideos(list, "avg_asc").map((v) => v.id).slice(0, 3)).toEqual(["baixo", "medio", "alto"]);
    expect(sortFilaVideos(list, "avg_desc").map((v) => v.id).slice(0, 3)).toEqual(["alto", "medio", "baixo"]);
    expect(sortFilaVideos(list, "posts_desc").map((v) => v.id)[0]).toBe("medio");
  });

  it("não mexe na lista original", () => {
    const copy = list.slice();
    sortFilaVideos(list, "views_desc");
    expect(list).toEqual(copy);
  });
});

describe("filterFilaVideos", () => {
  const list = [video("a", 1, 1), video("b", 1, 1, { pausedAt: "2026-10-22T10:00:00.000Z" })];
  it("separa ativos e pausados", () => {
    expect(filterFilaVideos(list, "all")).toHaveLength(2);
    expect(filterFilaVideos(list, "active").map((v) => v.id)).toEqual(["a"]);
    expect(filterFilaVideos(list, "paused").map((v) => v.id)).toEqual(["b"]);
  });
});

describe("pickSwapTarget", () => {
  // Posts posteriores da conta, do mais distante para o mais próximo.
  const later = [
    { id: "p5", video_id: "pausado2" },
    { id: "p4", video_id: "w" },
    { id: "p3", video_id: null },
    { id: "p2", video_id: "x" },
  ];
  const paused = new Set(["pausado1", "pausado2"]);

  it("pega o post mais distante com vídeo ativo", () => {
    expect(pickSwapTarget(later, paused, new Set())?.id).toBe("p4");
  });

  it("evita vídeo saindo em outra conta na mesma hora", () => {
    expect(pickSwapTarget(later, paused, new Set(["w"]))?.id).toBe("p2");
  });

  it("se todos os ativos estão saindo em outra conta, troca mesmo assim", () => {
    expect(pickSwapTarget(later, paused, new Set(["w", "x"]))?.id).toBe("p4");
  });

  it("sem post com vídeo ativo, nada para trocar", () => {
    expect(pickSwapTarget([{ id: "p1", video_id: "pausado1" }, { id: "p2", video_id: null }], paused, new Set())).toBeNull();
    expect(pickSwapTarget([], paused, new Set())).toBeNull();
  });
});
