import { describe, it, expect, beforeEach } from "vitest";
import type { AccountInfo, AnalyzeInput, PostRow, QueueConfig, QueueSource, VideoInfo } from "../lib/queue-insights/types";
import {
  analyzeQueue,
  buildVideoKeyResolver,
  chooseAccounts,
  chooseVideos,
  computeBestHour,
  computePatternDay,
  countedPosts,
  expectedPerPost,
  inheritedIntervalMinutes,
  intervalForPostsPerDay,
  isCounted,
  medianAccountGapMinutes,
  pickHotPost,
  postsPerDayForInterval,
  rankVideos,
  suggestedStartAt,
  type CountedPost,
  type RankedAccount,
  type RankedVideo,
} from "../lib/queue-insights/analyze";
import {
  HOT_TITLE,
  IDEAL_FOOTNOTE,
  IDEAL_NO_ACCOUNTS_TEXT,
  IDEAL_FEW_ACCOUNTS_TEXT,
  IDEAL_NO_VIDEOS_TEXT,
  IDEAL_OUT_OF_FOLDER_TEXT,
  IDEAL_TITLE,
  fmtDayMonth,
  fmtHour,
  fmtInt,
  hotBody,
  hotEyebrow,
  idealBody,
  idealEyebrow,
  plural,
} from "../lib/queue-insights/texts";
import { brtDay, brtHourStartMs, shiftDay } from "../lib/queue-insights/time";
import { mean, median } from "../lib/queue-insights/stats";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
/** 12:00 BRT de 21/10/2026. */
const NOW = new Date("2026-10-21T15:00:00.000Z");
const NOW_MS = NOW.getTime();
const TODAY = brtDay(NOW_MS);
const QUEUE_ID = "camp-1";

const iso = (ms: number) => new Date(ms).toISOString();
/** Instante BRT `hour`:`minute` de `daysAgo` dias atrás. */
const dayAt = (daysAgo: number, hour: number, minute = 0) =>
  brtHourStartMs(shiftDay(TODAY, -daysAgo), hour) + minute * MIN;

let seq = 0;
beforeEach(() => {
  seq = 0;
});

interface PostSpec {
  account: string;
  at: number;
  views: number | null;
  video?: string | null;
  /** undefined = igual ao video. */
  key?: string | null;
  source?: QueueSource;
  ig?: string;
}

function makePost(spec: PostSpec): PostRow {
  seq++;
  const video = spec.video === undefined ? null : spec.video;
  return {
    source: spec.source ?? "postar",
    postId: `p${seq}`,
    queueId: QUEUE_ID,
    accountId: spec.account,
    igAccountKey: spec.ig ?? `ig-${spec.account}`,
    videoId: video,
    videoKey: spec.key === undefined ? video : spec.key,
    publishedAt: iso(spec.at),
    publishedAtEstimated: false,
    views: spec.views,
    viewsReadAt: spec.views == null ? null : iso(Math.min(NOW_MS, spec.at + 2 * HOUR)),
    mediaId: `m${seq}`,
  };
}

/** Atalho: post da conta com o vídeo e as views, no instante `at`. */
const post = (account: string, video: string | null, views: number | null, at: number, extra: Partial<PostSpec> = {}) =>
  makePost({ account, video, views, at, ...extra });

function makeVideo(id: string, sourceUrl: string | null = null): VideoInfo {
  return { id, publicUrl: `https://cdn.test/${id}.mp4`, caption: `legenda ${id}`, folderId: "f1", sourceUrl };
}

function makeAccount(id: string, extra: Partial<AccountInfo> = {}): AccountInfo {
  return {
    id,
    username: `user-${id}`,
    avatarUrl: null,
    isActive: true,
    healthStatus: "healthy",
    igAccountKey: `ig-${id}`,
    ...extra,
  };
}

function makeQueue(extra: Partial<QueueConfig> = {}): QueueConfig {
  return {
    source: "postar",
    id: QUEUE_ID,
    label: "Postar · pasta Teste · 3 contas · desde 11/10",
    state: "running",
    accountCount: 3,
    intervalMinutes: 30,
    burstMode: false,
    publishedLast24h: 0,
    createdAt: iso(NOW_MS - 10 * DAY),
    folderId: "f1",
    folderName: "Teste",
    folderVideoIds: [],
    accountIds: [],
    videoCountCap: -1,
    postsPerDay: 48,
    handoff: {
      folderId: "f1",
      captionMode: "original",
      captions: [],
      autoCaptionType: null,
      stripHashtags: false,
      stripMentions: false,
      videoProcessingMode: "none",
      shareToFeed: true,
      useProxyPool: false,
      accountStaggerSeconds: null,
    },
    ...extra,
  };
}

const unique = <T,>(items: readonly T[]) => [...new Set(items)];

/**
 * Entrada do cálculo. Por padrão: contas = as dos posts (ativas), pasta = os
 * vídeos dos posts, Biblioteca = os vídeos dos posts.
 */
function makeInput(
  posts: PostRow[],
  extra: {
    queue?: Partial<QueueConfig>;
    accounts?: AccountInfo[];
    videos?: VideoInfo[];
  } = {},
): AnalyzeInput {
  const accountIds = unique(posts.map((p) => p.accountId));
  const videoIds = unique(posts.map((p) => p.videoId).filter((v): v is string => v != null));
  return {
    queue: makeQueue({ accountIds, folderVideoIds: videoIds, ...extra.queue }),
    queuePosts: posts,
    accounts: extra.accounts ?? accountIds.map((id) => makeAccount(id)),
    videos: extra.videos ?? videoIds.map((id) => makeVideo(id)),
  };
}

/** Posts contados já resolvidos (chave = videoKey do post). */
const counted = (posts: PostRow[]): CountedPost[] => countedPosts(posts, NOW_MS, buildVideoKeyResolver(posts, []));

function rankedVideo(videoKey: string, avgViews: number): RankedVideo {
  return { videoKey, videoId: videoKey, publicUrl: null, caption: null, avgViews, posts: 3, accounts: 3 };
}

function rankedAccount(id: string, avgViews: number): RankedAccount {
  return { accountId: id, igAccountKey: `ig-${id}`, username: `user-${id}`, avatarUrl: null, avgViews, posts: 3 };
}

// ---------------------------------------------------------------------------
// Post contado e números do topo
// ---------------------------------------------------------------------------

describe("post contado", () => {
  it("conta com views lidas e 1h ou mais de publicado", () => {
    expect(isCounted(post("a1", "v1", 0, NOW_MS - HOUR), NOW_MS)).toBe(true);
    expect(isCounted(post("a1", "v1", 500, NOW_MS - 59 * MIN), NOW_MS)).toBe(false);
    expect(isCounted(post("a1", "v1", null, NOW_MS - 5 * HOUR), NOW_MS)).toBe(false);
  });
});

describe("números do topo", () => {
  it("publicações contam tudo; views, média (A) e melhor post só os contados", () => {
    const posts = [
      post("a1", "v1", 100, dayAt(1, 9)),
      post("a2", "v1", 301, dayAt(1, 10)),
      post("a3", "v1", 900, NOW_MS - 30 * MIN), // < 1h: ainda subindo, entra só em publicações
      post("a1", "v2", null, dayAt(2, 9)), // sem leitura
    ];
    const { summary } = analyzeQueue(makeInput(posts), NOW);
    expect(summary.posts).toBe(4);
    expect(summary.totalViews).toBe(401);
    expect(summary.viewsPerPost).toBe(201); // 200,5 arredondado
    expect(summary.bestPostViews).toBe(301);
    expect(summary.since).toBe(iso(NOW_MS - 10 * DAY));
  });

  it("A sem arredondar decide o corte dos vídeos", () => {
    // A = (100×3 + 101×3) ÷ 6 = 100,5 → v1 (100) fica abaixo, v2 (101) passa
    const posts = [
      ...["a1", "a2", "a3"].map((a, i) => post(a, "v1", 100, dayAt(2, 9 + i))),
      ...["a1", "a2", "a3"].map((a, i) => post(a, "v2", 101, dayAt(2, 13 + i))),
    ];
    const keyOf = buildVideoKeyResolver(posts, []);
    const { eligible } = rankVideos({ counted: counted(posts), folderVideoIds: ["v1", "v2"], videos: [], keyOf });
    expect(analyzeQueue(makeInput(posts), NOW).summary.viewsPerPost).toBe(101);
    expect(chooseVideos(eligible, 100.5).map((v) => v.videoId)).toEqual(["v2", "v1"]); // < 3 passam → os 3 melhores
    expect(eligible.filter((v) => v.avgViews >= 100.5).map((v) => v.videoId)).toEqual(["v2"]);
  });

  it("fila mais velha que 30 dias conta só os últimos 30", () => {
    const posts = [post("a1", "v1", 100, dayAt(1, 9)), post("a1", "v1", 5000, NOW_MS - 31 * DAY)];
    const { summary } = analyzeQueue(makeInput(posts, { queue: { createdAt: iso(NOW_MS - 60 * DAY) } }), NOW);
    expect(summary.since).toBe(iso(NOW_MS - 30 * DAY));
    expect(summary.posts).toBe(1);
    expect(summary.totalViews).toBe(100);
  });

  it("fila com menos de 3 contas: explica que nunca vai fechar", () => {
    const posts = ["v1", "v2", "v3"].flatMap((v, i) => [
      post("a1", v, 100, dayAt(2, 9 + i)),
      post("a2", v, 200, dayAt(2, 12 + i)),
    ]);
    const res = analyzeQueue(makeInput(posts), NOW);
    expect(res.ideal).toBeNull();
    expect(res.idealUnavailable).toBe(IDEAL_FEW_ACCOUNTS_TEXT);
  });

  it("fila sem post: zeros, sem destaque e sem fila ideal", () => {
    const res = analyzeQueue(makeInput([], { queue: { accountIds: ["a1", "a2", "a3"] } }), NOW);
    expect(res.summary).toMatchObject({ posts: 0, totalViews: 0, viewsPerPost: null, bestPostViews: null });
    expect(res.hot).toBeNull();
    expect(res.ideal).toBeNull();
    expect(res.idealUnavailable).toBe(IDEAL_NO_VIDEOS_TEXT);
    expect(res.generatedAt).toBe(NOW.toISOString());
  });
});

// ---------------------------------------------------------------------------
// Vídeos
// ---------------------------------------------------------------------------

describe("vídeos elegíveis", () => {
  it("precisa de posts contados em 3 contas do Instagram", () => {
    const posts = [
      post("a1", "v1", 100, dayAt(2, 9)),
      post("a2", "v1", 200, dayAt(2, 10)),
      post("a3", "v1", 300, dayAt(2, 11)),
      // v2: 2 contas, uma delas postou duas vezes
      post("a1", "v2", 900, dayAt(2, 12)),
      post("a2", "v2", 900, dayAt(2, 13)),
      post("a2", "v2", 900, dayAt(3, 13)),
      // v3: a1 reconectada (outro id, mesma conta no IG) não vira terceira conta
      post("a1", "v3", 500, dayAt(2, 14)),
      post("a1b", "v3", 500, dayAt(2, 15), { ig: "ig-a1" }),
      post("a2", "v3", 500, dayAt(2, 16)),
      // v4: 3 contas, mas o post da terceira tem < 1h
      post("a1", "v4", 500, dayAt(2, 17)),
      post("a2", "v4", 500, dayAt(2, 18)),
      post("a3", "v4", 500, NOW_MS - 10 * MIN),
    ];
    const { eligible } = rankVideos({
      counted: counted(posts),
      folderVideoIds: ["v1", "v2", "v3", "v4"],
      videos: ["v1", "v2", "v3", "v4"].map((id) => makeVideo(id)),
      keyOf: buildVideoKeyResolver(posts, []),
    });
    expect(eligible.map((v) => v.videoId)).toEqual(["v1"]);
    expect(eligible[0]).toMatchObject({ avgViews: 200, posts: 3, accounts: 3, publicUrl: "https://cdn.test/v1.mp4" });
  });

  it("só vídeos ainda na pasta; outra cópia do mesmo Reel na pasta serve", () => {
    const posts = [
      ...["a1", "a2", "a3"].map((a, i) => post(a, "old", 100, dayAt(2, 9 + i), { key: "SC1" })),
      ...["a1", "a2", "a3"].map((a, i) => post(a, "gone", 100, dayAt(2, 12 + i))),
    ];
    const videos = [makeVideo("old"), makeVideo("gone"), makeVideo("new", "https://www.instagram.com/reel/SC1/")];
    const keyOf = buildVideoKeyResolver(posts, videos);
    const { eligible, outOfFolder } = rankVideos({ counted: countedPosts(posts, NOW_MS, keyOf), folderVideoIds: ["new"], videos, keyOf });
    expect(eligible.map((v) => v.videoId)).toEqual(["new"]);
    expect(eligible[0].caption).toBe("legenda new");
    expect(outOfFolder).toBe(1);
  });

  it("escolhe os de média ≥ A, no máximo 10", () => {
    const eligible = Array.from({ length: 12 }, (_, i) => rankedVideo(`v${i}`, 1000 - i * 10));
    expect(chooseVideos(eligible, 100).map((v) => v.videoKey)).toEqual(eligible.slice(0, 10).map((v) => v.videoKey));
    // empate com A passa
    const tie = [rankedVideo("a", 300), rankedVideo("b", 200), rankedVideo("c", 150), rankedVideo("d", 100)];
    expect(chooseVideos(tie, 150).map((v) => v.videoKey)).toEqual(["a", "b", "c"]);
  });

  it("menos de 3 acima de A: os 3 melhores elegíveis", () => {
    const eligible = [rankedVideo("a", 500), rankedVideo("b", 90), rankedVideo("c", 80), rankedVideo("d", 70)];
    expect(chooseVideos(eligible, 100).map((v) => v.videoKey)).toEqual(["a", "b", "c"]);
    expect(chooseVideos(eligible.slice(0, 2), 1000).map((v) => v.videoKey)).toEqual(["a", "b"]);
  });
});

// ---------------------------------------------------------------------------
// Contas
// ---------------------------------------------------------------------------

describe("contas escolhidas", () => {
  /** `n` posts da conta com `views` cada, em horas diferentes. */
  const many = (account: string, n: number, views: number) =>
    Array.from({ length: n }, (_, i) => post(account, `x-${account}-${i}`, views, dayAt(2 + i, 9)));

  const posts = [
    ...many("a1", 3, 200),
    ...many("a2", 3, 150),
    ...many("a3", 4, 120),
    ...many("a4", 2, 900), // poucos posts
    ...many("a5", 3, 999), // fora do ar
    ...many("a6", 3, 999), // com erro
    ...many("a7", 3, 999), // não é da fila
  ];
  const accounts = [
    makeAccount("a1"),
    makeAccount("a2"),
    makeAccount("a3"),
    makeAccount("a4"),
    makeAccount("a5", { isActive: false }),
    makeAccount("a6", { healthStatus: "error" }),
    makeAccount("a7"),
  ];
  const accountById = new Map(accounts.map((a) => [a.id, a]));
  const queue = { accountIds: ["a1", "a2", "a3", "a4", "a5", "a6"] };

  it("ativas, sem erro, 3+ posts e média ≥ A, da maior para a menor", () => {
    const chosen = chooseAccounts({ counted: counted(posts), queue, accountById, average: 100 });
    expect(chosen.map((a) => a.accountId)).toEqual(["a1", "a2", "a3"]);
    expect(chosen[2]).toMatchObject({ avgViews: 120, posts: 4, username: "user-a3" });
  });

  it("menos de 3 acima de A: as 3 melhores, primeiro as com 3+ posts", () => {
    const chosen = chooseAccounts({ counted: counted(posts), queue, accountById, average: 160 });
    expect(chosen.map((a) => a.accountId)).toEqual(["a1", "a2", "a3"]);
    const fewQueue = { accountIds: ["a1", "a2", "a4"] };
    expect(chooseAccounts({ counted: counted(posts), queue: fewQueue, accountById, average: 160 }).map((a) => a.accountId)).toEqual([
      "a1",
      "a2",
      "a4",
    ]);
  });

  it("conta reconectada soma os posts da conexão antiga (mesma conta no IG)", () => {
    const reconnected = [
      post("old", "v1", 300, dayAt(2, 9), { ig: "ig-a1" }),
      post("old", "v2", 300, dayAt(3, 9), { ig: "ig-a1" }),
      post("a1", "v3", 300, dayAt(4, 9)),
    ];
    const chosen = chooseAccounts({ counted: counted(reconnected), queue: { accountIds: ["a1"] }, accountById, average: 100 });
    expect(chosen).toHaveLength(1);
    expect(chosen[0]).toMatchObject({ accountId: "a1", posts: 3, avgViews: 300 });
  });
});

// ---------------------------------------------------------------------------
// Views esperadas, horário, início e dia
// ---------------------------------------------------------------------------

describe("views esperadas por publicação", () => {
  const videos = [rankedVideo("v1", 400), rankedVideo("v2", 200)];
  const accounts = [rankedAccount("a1", 0), rankedAccount("a2", 0)];

  it("com 5+ posts vídeo escolhido × conta escolhida: média deles", () => {
    const posts = [
      post("a1", "v1", 100, dayAt(2, 9)),
      post("a2", "v1", 200, dayAt(2, 10)),
      post("a1", "v2", 300, dayAt(2, 11)),
      post("a2", "v2", 400, dayAt(2, 12)),
      post("a1", "v1", 500, dayAt(3, 9)),
      post("a9", "v1", 9999, dayAt(3, 10)), // conta não escolhida
      post("a1", "v9", 9999, dayAt(3, 11)), // vídeo não escolhido
    ];
    expect(expectedPerPost(counted(posts), videos, accounts)).toBe(300);
  });

  it("com menos de 5: média das médias dos vídeos escolhidos", () => {
    const posts = [post("a1", "v1", 100, dayAt(2, 9)), post("a2", "v2", 200, dayAt(2, 10))];
    expect(expectedPerPost(counted(posts), videos, accounts)).toBe(300);
  });
});

describe("melhor horário", () => {
  it("hora BRT com a maior média das contas escolhidas, só com 5+ posts", () => {
    const posts = [
      ...Array.from({ length: 4 }, (_, i) => post("a1", "v1", 5000, dayAt(2 + i, 20))), // 4 posts: não vale
      ...Array.from({ length: 5 }, (_, i) => post("a2", "v1", 300, dayAt(2 + i, 10, 15))),
      ...Array.from({ length: 5 }, (_, i) => post("a1", "v1", 200, dayAt(2 + i, 15))),
      ...Array.from({ length: 5 }, (_, i) => post("a9", "v1", 9000, dayAt(2 + i, 18))), // conta não escolhida
    ];
    expect(computeBestHour(counted(posts), new Set(["ig-a1", "ig-a2"]))).toEqual({ hour: 10, views: 300 });
    expect(computeBestHour(counted(posts.slice(0, 4)), new Set(["ig-a1"]))).toBeNull();
  });
});

describe("início sugerido", () => {
  it("próxima HH:00 BRT pelo menos 10 min à frente", () => {
    expect(suggestedStartAt(NOW_MS, 13)).toBe("2026-10-21T16:00:00.000Z");
    // 12:00 < 12:10 → amanhã
    expect(suggestedStartAt(NOW_MS, 12)).toBe("2026-10-22T15:00:00.000Z");
    expect(suggestedStartAt(NOW_MS - 15 * MIN, 12)).toBe("2026-10-21T15:00:00.000Z");
  });

  it("vira o dia BRT perto da meia-noite", () => {
    const at2355 = Date.parse("2026-10-22T02:55:00.000Z"); // 23:55 BRT de 21/10
    expect(suggestedStartAt(at2355, 0)).toBe("2026-10-23T03:00:00.000Z"); // 00:00 BRT de 23/10
    expect(suggestedStartAt(at2355, 23)).toBe("2026-10-23T02:00:00.000Z"); // 23:00 BRT de 22/10
    const at2330 = Date.parse("2026-10-22T02:30:00.000Z"); // 23:30 BRT de 21/10
    expect(suggestedStartAt(at2330, 0)).toBe("2026-10-22T03:00:00.000Z"); // 00:00 BRT de 22/10
  });

  it("sem melhor horário: agora + 10 min, para cima em 5 min", () => {
    expect(suggestedStartAt(NOW_MS + 3 * MIN + 20_000, null)).toBe("2026-10-21T15:15:00.000Z");
    expect(suggestedStartAt(NOW_MS, null)).toBe("2026-10-21T15:10:00.000Z");
  });
});

describe("padrão do dia", () => {
  /** 20 posts (5 contas × 4 vídeos) no dia `daysAgo`, `views` cada. */
  const day = (daysAgo: number, views: number, prefix = "v") =>
    ["a1", "a2", "a3", "a4", "a5"].flatMap((a, i) =>
      [1, 2, 3, 4].map((n) => post(a, `${prefix}${n}`, views, dayAt(daysAgo, i * 4 + n))),
    );

  it("dia com 20+ posts contados e a maior média por post", () => {
    const posts = [...day(3, 500), ...day(5, 300), ...day(4, 9999).slice(0, 19)];
    const keyOf = buildVideoKeyResolver(posts, []);
    expect(computePatternDay(countedPosts(posts, NOW_MS, keyOf), posts, keyOf)).toBe("18/10");
  });

  it("some quando uma conta postou o mesmo vídeo duas vezes no dia", () => {
    const posts = [...day(3, 500), post("a1", "v1", 500, dayAt(3, 23))];
    const keyOf = buildVideoKeyResolver(posts, []);
    expect(computePatternDay(countedPosts(posts, NOW_MS, keyOf), posts, keyOf)).toBeNull();
  });

  it("outra cópia do mesmo Reel também é repetição", () => {
    const posts = [...day(3, 500), post("a1", "v1-copia", 500, dayAt(3, 23), { key: "v1" })];
    const keyOf = buildVideoKeyResolver(posts, []);
    expect(computePatternDay(countedPosts(posts, NOW_MS, keyOf), posts, keyOf)).toBeNull();
  });

  it("sem dia com 20 posts contados: null", () => {
    const posts = day(3, 500).slice(0, 19);
    const keyOf = buildVideoKeyResolver(posts, []);
    expect(computePatternDay(countedPosts(posts, NOW_MS, keyOf), posts, keyOf)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Ritmo herdado
// ---------------------------------------------------------------------------

describe("ritmo herdado da fila", () => {
  it("Postar normal: floor(1440 / posts_per_day)", () => {
    expect(inheritedIntervalMinutes(makeQueue({ postsPerDay: 48, intervalMinutes: 30 }), [])).toBe(30);
    expect(inheritedIntervalMinutes(makeQueue({ postsPerDay: 7, intervalMinutes: 205 }), [])).toBe(205);
  });

  it("Loop: interval_minutes", () => {
    expect(inheritedIntervalMinutes(makeQueue({ source: "loop", postsPerDay: 16, intervalMinutes: 90 }), [])).toBe(90);
  });

  it("Modo Ciclo: mediana entre contas da mediana dos intervalos; sem posts, 60", () => {
    const at = (account: string, minutes: number[]) =>
      minutes.map((m) => post(account, "v1", 1, dayAt(2, 0) + m * MIN));
    const posts = [...at("a1", [0, 20, 40, 80]), ...at("a2", [0, 30, 60]), ...at("a3", [0, 50]), ...at("a4", [0])];
    expect(medianAccountGapMinutes(posts)).toBe(30);
    const ciclo = makeQueue({ burstMode: true, intervalMinutes: null, postsPerDay: null });
    expect(inheritedIntervalMinutes(ciclo, posts)).toBe(30);
    expect(inheritedIntervalMinutes(ciclo, [])).toBe(60);
  });

  it("posts por dia com teto de 48 e intervalo exibido", () => {
    expect(postsPerDayForInterval(205)).toBe(7);
    expect(intervalForPostsPerDay(7)).toBe(205);
    expect(postsPerDayForInterval(10)).toBe(48);
    expect(intervalForPostsPerDay(48)).toBe(30);
    expect(postsPerDayForInterval(3000)).toBe(1);
    expect(postsPerDayForInterval(0)).toBe(48);
  });
});

// ---------------------------------------------------------------------------
// Post indo muito bem agora
// ---------------------------------------------------------------------------

describe("post indo muito bem agora", () => {
  it("o de mais views das últimas 48h; sem nenhum, o de mais views da fila", () => {
    const old = post("a1", "v1", 5000, NOW_MS - 3 * DAY);
    const recent = post("a2", "v2", 800, NOW_MS - 10 * HOUR);
    const tooNew = post("a3", "v3", 9999, NOW_MS - 30 * MIN);
    expect(pickHotPost(counted([old, recent, tooNew]), NOW_MS)?.post.postId).toBe(recent.postId);
    expect(pickHotPost(counted([old, tooNew]), NOW_MS)?.post.postId).toBe(old.postId);
  });

  it("só aparece com views > 0; post recente com 0 views não tira o lugar do melhor da fila", () => {
    const res = analyzeQueue(makeInput([post("a1", "v1", 0, NOW_MS - 3 * HOUR)]), NOW);
    expect(res.hot).toBeNull();
    const old = post("a1", "v1", 700, NOW_MS - 5 * DAY);
    const zero = post("a2", "v2", 0, NOW_MS - 3 * HOUR);
    expect(pickHotPost(counted([old, zero]), NOW_MS)?.post.postId).toBe(old.postId);
  });

  it("vídeo apagado da Biblioteca: usa outra cópia do Reel; sem nenhuma, videoId null", () => {
    const hot = post("a1", "v1", 2000, NOW_MS - 5 * HOUR, { key: "SC1" });
    const withCopy = analyzeQueue(
      makeInput([hot], { videos: [makeVideo("v1-copia", "https://www.instagram.com/reel/SC1/")], queue: { folderVideoIds: [] } }),
      NOW,
    );
    expect(withCopy.hot).toMatchObject({ videoId: "v1-copia", publicUrl: "https://cdn.test/v1-copia.mp4" });
    const gone = analyzeQueue(makeInput([hot], { videos: [], queue: { folderVideoIds: [] } }), NOW);
    expect(gone.hot).toMatchObject({ videoId: null, publicUrl: null, views: 2000 });
  });

  it("Publicar nas outras contas: ativas, sem erro, que não publicaram o vídeo (nem outra cópia) nas últimas 24h", () => {
    const hot = post("a1", "v1", 2000, NOW_MS - 5 * HOUR, { key: "SC1" });
    const posts = [
      hot,
      post("a8", "v1", 100, dayAt(5, 9), { key: "SC1", ig: "ig-a1" }),
      post("a2", "v1-copia", 50, NOW_MS - 3 * HOUR, { key: "SC1" }), // outra cópia, há 3h
      post("a6", "v1", 80, NOW_MS - 2 * DAY, { key: "SC1" }), // há 2 dias: pode de novo
    ];
    const accounts = [
      makeAccount("a1"),
      makeAccount("a2"),
      makeAccount("a3", { isActive: false }),
      makeAccount("a4", { healthStatus: "error" }),
      makeAccount("a5"),
      makeAccount("a6"),
      makeAccount("a8", { igAccountKey: "ig-a1" }), // a1 reconectada
      makeAccount("a9"), // fora da fila
    ];
    const videos = [makeVideo("v1"), makeVideo("v1-copia", "https://www.instagram.com/reels/SC1/")];
    const res = analyzeQueue(
      makeInput(posts, {
        accounts,
        videos,
        queue: { accountIds: ["a1", "a2", "a3", "a4", "a5", "a6", "a7", "a8"] },
      }),
      NOW,
    );
    expect(res.hot?.postId).toBe(hot.postId);
    expect(res.hot?.republishAccountIds).toEqual(["a5", "a6"]);
    expect(res.hot).toMatchObject({
      accountId: "a1",
      username: "user-a1",
      videoId: "v1",
      publicUrl: "https://cdn.test/v1.mp4",
      mediaId: hot.mediaId,
      views: 2000,
      publishedAt: hot.publishedAt,
      title: HOT_TITLE,
    });
  });

  it("textos: sobrelinha, vídeo que rende bem e post que saiu da curva", () => {
    const at = Date.parse("2026-10-20T12:30:00.000Z"); // 09:30 BRT de 20/10
    const others = [
      post("a1", "v2", 100, dayAt(4, 9)),
      post("a2", "v2", 100, dayAt(4, 10)),
      post("a3", "v2", 100, dayAt(4, 11)),
      post("a1", "v3", 100, dayAt(4, 12)),
    ];
    // v1 rende bem: mediana 900 ≥ média da fila (3.934 ÷ 7 = 562)
    const good = [post("a1", "v1", 1834, at), post("a2", "v1", 900, dayAt(3, 9)), post("a3", "v1", 800, dayAt(3, 10))];
    const res = analyzeQueue(makeInput([...good, ...others]), NOW);
    expect(res.hot?.eyebrow).toBe("1.834 views em 20/10 às 09h");
    expect(res.hot?.videoTypicalViews).toBe(900);
    expect(res.hot?.body).toBe(
      "A publicação da @user-a1 já passou de 1.834 visualizações. Esse vídeo já rende bem em geral: " +
        "900 visualizações na publicação típica dele. Vale colocar esse vídeo nas outras contas ainda hoje — o assunto está quente.",
    );

    // v9 saiu da curva: mediana 40 < média da fila
    const outlier = [post("a1", "v9", 5000, NOW_MS - 2 * HOUR), post("a2", "v9", 40, dayAt(3, 9)), post("a3", "v9", 30, dayAt(3, 10))];
    const res2 = analyzeQueue(makeInput([...outlier, ...others]), NOW);
    expect(res2.hot?.videoTypicalViews).toBe(40);
    expect(res2.hot?.body).toBe(
      "A publicação da @user-a1 já passou de 5.000 visualizações. Esse post saiu da curva: " +
        "na publicação típica o vídeo faz 40 visualizações. Vale testar ele nas outras contas ainda hoje.",
    );
  });
});

// ---------------------------------------------------------------------------
// Fila ideal (cálculo inteiro)
// ---------------------------------------------------------------------------

describe("fila ideal", () => {
  /** 3 contas × 4 vídeos, um post por hora (nenhuma hora com 5 posts). */
  const grid = () => {
    const views: Record<string, number> = { v1: 300, v2: 200, v3: 100, v4: 40 };
    let hour = 0;
    return Object.entries(views).flatMap(([video, v]) =>
      ["a1", "a2", "a3"].map((a) => post(a, video, v, dayAt(2, hour++))),
    );
  };

  it("cruza os melhores vídeos com as melhores contas", () => {
    const res = analyzeQueue(makeInput(grid()), NOW);
    expect(res.idealUnavailable).toBeNull();
    const ideal = res.ideal!;
    // A = 160: só v1 e v2 passam → os 3 melhores elegíveis
    expect(ideal.videos.map((v) => v.videoId)).toEqual(["v1", "v2", "v3"]);
    expect(ideal.videos[0]).toEqual({
      videoId: "v1",
      publicUrl: "https://cdn.test/v1.mp4",
      caption: "legenda v1",
      avgViews: 300,
      posts: 3,
      accounts: 3,
    });
    // cada conta: média 160 = A → passa
    expect(ideal.accounts.map((a) => a.accountId)).toEqual(["a1", "a2", "a3"]);
    expect(ideal.accounts[0]).toEqual({ accountId: "a1", username: "user-a1", avatarUrl: null, avgViews: 160, posts: 4 });
    expect(ideal.postsPerCycle).toBe(9);
    expect(ideal.intervalMinutes).toBe(30);
    expect(ideal.postsPerDay).toBe(48);
    expect(ideal.expectedPerPost).toBe(200);
    expect(ideal.medianPerPost).toBe(150);
    expect(ideal.bestHour).toBeNull();
    expect(ideal.bestHourViews).toBeNull();
    expect(ideal.patternDay).toBeNull();
    expect(ideal.startAt).toBe("2026-10-21T15:10:00.000Z");
    expect(ideal.eyebrow).toBe("~200 views por publicação");
    expect(ideal.title).toBe(IDEAL_TITLE);
    expect(ideal.footnote).toBe(IDEAL_FOOTNOTE);
    expect(ideal.body).toBe(
      "Cruzei os seus 3 melhores vídeos com as suas 3 melhores contas: 9 publicações por ciclo, uma a cada 30 min. — " +
        "são 200 visualizações por publicação, contra 150 do seu material mediano. Nenhuma conta repete o mesmo vídeo.",
    );
  });

  it("com melhor horário: frase do horário e início na próxima HH:00", () => {
    // v1 e v2 às 21h em dias diferentes: 6 posts, média 250
    const posts = grid().map((p, i) =>
      p.videoId === "v1" || p.videoId === "v2" ? { ...p, publishedAt: iso(dayAt(2 + i, 21)) } : p,
    );
    // Ritmo lento (6/dia): o início espera a melhor hora.
    const ideal = analyzeQueue(makeInput(posts, { queue: { postsPerDay: 6 } }), NOW).ideal!;
    expect(ideal.bestHour).toBe(21);
    expect(ideal.bestHourViews).toBe(250);
    expect(ideal.startAt).toBe("2026-10-22T00:00:00.000Z"); // 21:00 BRT de 21/10
    expect(ideal.body).toContain(" E o melhor horário para elas é 21h, onde você tem tido 250 visualizações.");
    // Ritmo rápido (48/dia): a fila passa pelo dia todo, começa em 10 min.
    const fast = analyzeQueue(makeInput(posts), NOW).ideal!;
    expect(fast.bestHour).toBe(21);
    expect(fast.startAt).toBe("2026-10-21T15:10:00.000Z");
  });

  it("com padrão do dia: o texto cita a data", () => {
    const views: Record<string, number> = { v1: 500, v2: 400, v3: 300, v4: 100 };
    let hour = 0;
    const posts = Object.entries(views).flatMap(([video, v]) =>
      ["a1", "a2", "a3", "a4", "a5"].map((a) => post(a, video, v, dayAt(3, hour++))),
    );
    const ideal = analyzeQueue(makeInput(posts, { queue: { postsPerDay: 7, intervalMinutes: 205 } }), NOW).ideal!;
    expect(ideal.patternDay).toBe("18/10");
    expect(ideal.intervalMinutes).toBe(205);
    expect(ideal.postsPerDay).toBe(7);
    expect(ideal.body).toBe(
      "Cruzei os seus 3 melhores vídeos com as suas 5 melhores contas: 15 publicações por ciclo, uma a cada 205 min. — " +
        "são 400 visualizações por publicação, contra 350 do seu material mediano. " +
        "Nenhuma conta repete o mesmo vídeo — que foi o padrão do dia 18/10.",
    );
  });

  it("Modo Ciclo herda o intervalo medido nos posts", () => {
    const posts = ["v1", "v2", "v3"].flatMap((video, i) =>
      ["a1", "a2", "a3"].map((a) => post(a, video, 100, dayAt(2, 8) + i * 45 * MIN)),
    );
    const ideal = analyzeQueue(makeInput(posts, { queue: { burstMode: true, intervalMinutes: null, postsPerDay: null } }), NOW).ideal!;
    expect(ideal.postsPerDay).toBe(32);
    expect(ideal.intervalMinutes).toBe(45);
  });

  it("sem vídeo em 3 contas: diz por quê", () => {
    const posts = [post("a1", "v1", 100, dayAt(2, 9)), post("a2", "v1", 100, dayAt(2, 10))];
    const res = analyzeQueue(makeInput(posts, { queue: { accountIds: ["a1", "a2", "a3"] } }), NOW);
    expect(res.ideal).toBeNull();
    expect(res.idealUnavailable).toBe(IDEAL_NO_VIDEOS_TEXT);
  });

  it("vídeos com 3 contas fora da pasta: diz por quê", () => {
    const res = analyzeQueue(makeInput(grid(), { queue: { folderVideoIds: ["outro"] } }), NOW);
    expect(res.ideal).toBeNull();
    expect(res.idealUnavailable).toBe(IDEAL_OUT_OF_FOLDER_TEXT);
  });

  it("nenhuma conta ativa e sem erro: diz por quê", () => {
    const accounts = [
      makeAccount("a1", { isActive: false }),
      makeAccount("a2", { healthStatus: "error" }),
      makeAccount("a3", { isActive: false }),
    ];
    const res = analyzeQueue(makeInput(grid(), { accounts }), NOW);
    expect(res.ideal).toBeNull();
    expect(res.idealUnavailable).toBe(IDEAL_NO_ACCOUNTS_TEXT);
    expect(res.hot?.republishAccountIds).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Textos e números pt-BR
// ---------------------------------------------------------------------------

describe("estatística", () => {
  it("mediana e média", () => {
    expect(median([])).toBeNull();
    expect(median([30, 10, 20])).toBe(20);
    expect(median([40, 10, 30, 20])).toBe(25);
    expect(mean([])).toBeNull();
    expect(mean([1, 2])).toBe(1.5);
  });

  it("material mediano = mediana das views dos posts contados", () => {
    const posts = [
      post("a1", "v1", 10, dayAt(2, 9)),
      post("a2", "v1", 20, dayAt(2, 10)),
      post("a3", "v1", 1000, dayAt(2, 11)),
      post("a1", "v2", 40, dayAt(2, 12)),
      post("a2", "v2", 9999, NOW_MS - 20 * MIN), // < 1h: fora
    ];
    expect(analyzeQueue(makeInput(posts), NOW).ideal?.medianPerPost).toBe(30);
  });
});

describe("formatação pt-BR", () => {
  it("milhar com ponto, sem casas", () => {
    expect(fmtInt(0)).toBe("0");
    expect(fmtInt(999)).toBe("999");
    expect(fmtInt(1234)).toBe("1.234");
    expect(fmtInt(1234567)).toBe("1.234.567");
    expect(fmtInt(1234.6)).toBe("1.235");
    expect(fmtInt(-1234)).toBe("-1.234");
    expect(plural(1, "publicação", "publicações")).toBe("1 publicação");
    expect(plural(1440, "publicação", "publicações")).toBe("1.440 publicações");
  });

  it("hora e data em BRT", () => {
    expect(fmtHour(9)).toBe("09h");
    expect(fmtHour(21)).toBe("21h");
    expect(fmtDayMonth("2026-10-09T15:00:00.000Z")).toBe("09/10");
    expect(fmtDayMonth("2026-10-10T02:00:00.000Z")).toBe("09/10"); // 23h BRT de 09/10
    expect(hotEyebrow(108834, "2026-10-09T12:05:00.000Z")).toBe("108.834 views em 09/10 às 09h");
    expect(idealEyebrow(1868)).toBe("~1.868 views por publicação");
  });

  it("texto da fila ideal no singular e com números grandes", () => {
    expect(
      idealBody({
        n: 1,
        m: 1,
        postsPerCycle: 1,
        intervalMinutes: 1440,
        expectedPerPost: 12345,
        medianPerPost: 1029,
        bestHour: 8,
        bestHourViews: 2500,
        patternDay: null,
      }),
    ).toBe(
      "Cruzei o seu melhor vídeo com a sua melhor conta: 1 publicação por ciclo, uma a cada 1.440 min. — " +
        "são 12.345 visualizações por publicação, contra 1.029 do seu material mediano. " +
        "E o melhor horário para ela é 08h, onde você tem tido 2.500 visualizações. Nenhuma conta repete o mesmo vídeo.",
    );
  });

  it("post sem vídeo conhecido: só a abertura e o convite", () => {
    expect(hotBody({ username: "x", views: 1500, typicalViews: null, queueAverage: 100 })).toBe(
      "A publicação da @x já passou de 1.500 visualizações. Vale colocar esse vídeo nas outras contas ainda hoje — o assunto está quente.",
    );
  });
});
