import { describe, it, expect, beforeEach } from "vitest";
import type {
  AccountInfo,
  AccountScore,
  AnalyzeInput,
  IdealInputs,
  PostRow,
  QueueConfig,
  QueueSource,
  SnapshotRow,
  VideoInfo,
  VideoScore,
} from "../lib/queue-insights/types";
import { analyzeQueue, inheritedIntervalMinutes } from "../lib/queue-insights/analyze";
import { buildIdealQueue, chooseStart, gridExpectation, phaseScore } from "../lib/queue-insights/ideal";
import { buildNormals, isMature, multipleOf, type Normals, type ScoredPost } from "../lib/queue-insights/normals";
import { buildVideoKeyResolver, scoreVideos, videoKeyOf } from "../lib/queue-insights/videos";
import { rankAccounts } from "../lib/queue-insights/accounts";
import {
  bestDayMinPosts,
  buildDayPatternContext,
  computeBestDay,
  computeBestHour,
  medianAccountGapMinutes,
} from "../lib/queue-insights/timing";
import { buildHotSection, hotViewsThreshold, risingTextFor, type CardContext } from "../lib/queue-insights/hot";
import {
  collectingEtaHours,
  computeReadiness,
  isQueueImpossible,
  videoCoverage,
} from "../lib/queue-insights/readiness";
import { computeRepostFactor } from "../lib/queue-insights/baseline";
import { fmtInt, fmtMultiple } from "../lib/queue-insights/texts";
import { brtDay, brtHourStartMs, shiftDay, toMs } from "../lib/queue-insights/time";

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
  /** undefined = esta fila; null = post fora de fila. */
  queue?: string | null;
  source?: QueueSource;
  /** Horas entre publicação e a última leitura que deu certo; null = nunca leu. */
  readAfterHours?: number | null;
  ig?: string;
}

function makePost(spec: PostSpec): PostRow {
  seq++;
  const hoursSince = (NOW_MS - spec.at) / HOUR;
  const readAfter = spec.readAfterHours === undefined ? Math.min(24, hoursSince) : spec.readAfterHours;
  const video = spec.video === undefined ? null : spec.video;
  return {
    source: spec.source ?? "postar",
    postId: `p${seq}`,
    queueId: spec.queue === undefined ? QUEUE_ID : spec.queue,
    accountId: spec.account,
    igAccountKey: spec.ig ?? `ig-${spec.account}`,
    videoId: video,
    videoKey: spec.key === undefined ? video : spec.key,
    publishedAt: iso(spec.at),
    publishedAtEstimated: false,
    views: spec.views,
    viewsReadAt: readAfter == null ? null : iso(spec.at + readAfter * HOUR),
    mediaId: `m${seq}`,
  };
}

/** ScoredPost montado à mão (normal local informado). */
function scored(post: PostRow, localNormal: number | null, mature = isMature(post, NOW_MS)): ScoredPost {
  return {
    post,
    ms: toMs(post.publishedAt),
    mature,
    localNormal,
    multiple: mature ? multipleOf(post.views, localNormal) : null,
  };
}

/** Post maduro de 2 dias atrás com views = múltiplo × 100 (normal local 100). */
function vote(account: string, video: string, multiple: number, extra: Partial<PostSpec> = {}): ScoredPost {
  return scored(makePost({ account, at: dayAt(2, 10), views: multiple * 100, video, ...extra }), 100);
}

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
    label: "Postar · pasta Teste · 4 contas · desde 11/10",
    state: "running",
    accountCount: 4,
    intervalMinutes: 60,
    burstMode: false,
    publishedLast24h: 0,
    createdAt: iso(NOW_MS - 10 * DAY),
    folderId: "f1",
    folderName: "Teste",
    folderVideoIds: [],
    accountIds: [],
    videoCountCap: 4,
    postsPerDay: 24,
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

function fakeNormals(current: Record<string, number | null>): Normals {
  return {
    localOnDay: () => null,
    localFor: () => null,
    current: (ig) => (current[ig] == null ? { value: null, windowDays: null } : { value: current[ig] as number, windowDays: 7 }),
  };
}

/** `count` posts maduros fora da fila, um por hora a partir de `hour`, no dia `daysAgo`. */
function history(account: string, daysAgo: number, count: number, views: number, startHour = 0): PostRow[] {
  return Array.from({ length: count }, (_, i) =>
    makePost({ account, at: dayAt(daysAgo, (startHour + i) % 24, Math.floor((startHour + i) / 24) * 10), views, queue: null, video: `h${seq}` }),
  );
}

function videoScore(videoId: string, score: number, extra: Partial<VideoScore> = {}): VideoScore {
  return {
    videoKey: videoId,
    videoId,
    publicUrl: null,
    caption: null,
    score,
    votingAccounts: 3,
    accountsAboveNormal: 3,
    posts: 3,
    matureViewsMedian: 100,
    matureViewsMean: 100,
    status: "passes",
    ...extra,
  };
}

function accountScore(accountId: string, currentNormal: number | null, status: AccountScore["status"] = "good"): AccountScore {
  return {
    accountId,
    username: `user-${accountId}`,
    avatarUrl: null,
    currentNormal,
    normalWindowDays: currentNormal == null ? null : 7,
    postsInQueue: 0,
    status,
  };
}

function idealInputs(extra: Partial<IdealInputs> = {}): IdealInputs {
  return {
    videos: [],
    accounts: [],
    defaultN: 0,
    defaultM: 0,
    maxN: 50,
    intervalMinutes: 60,
    postsPerDay: 24,
    accountStaggerSeconds: null,
    repostFactor: 1,
    repostPairs: 0,
    usedVideoIdsByAccount: {},
    currentTypicalPerPost: null,
    currentMeanAccountNormal: null,
    currentMeanVideoScore: null,
    currentObservedMedian: null,
    bestHour: null,
    nowIso: NOW.toISOString(),
    ...extra,
  };
}

// ---------------------------------------------------------------------------
// 1. Post maduro
// ---------------------------------------------------------------------------

describe("maturidade", () => {
  it("leitura feita 4h+ depois da publicação, com 4h+ de post, é madura", () => {
    expect(isMature(makePost({ account: "a", at: NOW_MS - 10 * HOUR, views: 100, readAfterHours: 6 }), NOW_MS)).toBe(true);
  });

  it("leitura que falhou depois das 2h deixa o post imaturo (viewsReadAt parado nas 2h)", () => {
    expect(isMature(makePost({ account: "a", at: NOW_MS - 10 * HOUR, views: 100, readAfterHours: 2 }), NOW_MS)).toBe(false);
  });

  it("post com menos de 4h, sem views ou nunca lido não é maduro", () => {
    expect(isMature(makePost({ account: "a", at: NOW_MS - 3 * HOUR, views: 100 }), NOW_MS)).toBe(false);
    expect(isMature(makePost({ account: "a", at: NOW_MS - 10 * HOUR, views: null, readAfterHours: 6 }), NOW_MS)).toBe(false);
    expect(isMature(makePost({ account: "a", at: NOW_MS - 10 * HOUR, views: 100, readAfterHours: null }), NOW_MS)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 2. Normal da conta
// ---------------------------------------------------------------------------

describe("normal local e atual", () => {
  const d = shiftDay(TODAY, -5);

  it("d±1 → d±3 → janela de 14 dias → null", () => {
    const posts = [
      ...history("a", 5, 20, 100), // 20 no próprio dia
      ...history("b", 5, 10, 100),
      ...history("b", 7, 10, 300), // só fecha 20 em d±3
      ...history("c", 9, 10, 50),
      ...history("c", 13, 10, 70), // só fecha 20 na janela de 14 dias
      ...history("c2", 9, 10, 50),
      ...history("c2", 13, 9, 70),
      ...history("c2", 16, 5, 999), // fora da janela de 14 dias: não conta
      ...history("d", 5, 15, 100), // nunca chega a 20
    ];
    const normals = buildNormals(posts, NOW);
    expect(normals.localOnDay("ig-a", d)).toBe(100);
    expect(normals.localOnDay("ig-b", d)).toBe(200);
    expect(normals.localOnDay("ig-c", d)).toBe(60);
    expect(normals.localOnDay("ig-c2", d)).toBeNull();
    expect(normals.localOnDay("ig-d", d)).toBeNull();
  });

  it("post imaturo não entra no normal", () => {
    const posts = [...history("a", 5, 19, 100), makePost({ account: "a", at: dayAt(5, 22), views: 100, queue: null, readAfterHours: 1 })];
    expect(buildNormals(posts, NOW).localOnDay("ig-a", d)).toBeNull();
  });

  it("normal atual: 3 → 7 → 14 dias, senão sem dados", () => {
    const posts = [
      ...history("a", 1, 20, 100),
      ...history("b", 1, 10, 100),
      ...history("b", 5, 10, 200),
      ...history("c", 10, 20, 80),
      ...history("d", 10, 19, 80),
    ];
    const normals = buildNormals(posts, NOW);
    expect(normals.current("ig-a")).toEqual({ value: 100, windowDays: 3 });
    expect(normals.current("ig-b")).toEqual({ value: 150, windowDays: 7 });
    expect(normals.current("ig-c")).toEqual({ value: 80, windowDays: 14 });
    expect(normals.current("ig-d")).toEqual({ value: null, windowDays: null });
  });

  it("conta nova com normal 6 não vota (portão ≥ 30), mas o destaque usa qualquer normal > 0", () => {
    const normals = buildNormals(history("novo", 5, 20, 6), NOW);
    const queuePost = makePost({ account: "novo", at: dayAt(5, 21), views: 60, video: "v1" });
    const local = normals.localFor(queuePost);
    expect(local).toBe(6);
    expect(multipleOf(queuePost.views, local)).toBeNull();
    expect(multipleOf(queuePost.views, local, 0)).toBe(10);

    const [videoScored] = scoreVideos({
      posts: [scored(queuePost, local)],
      videos: [makeVideo("v1")],
      folderVideoIds: ["v1"],
      keyOf: (id) => id,
    });
    expect(videoScored.votingAccounts).toBe(0);
    expect(videoScored.score).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 3. Nota do vídeo
// ---------------------------------------------------------------------------

describe("nota do vídeo", () => {
  const folder = ["v1"];
  const videos = [makeVideo("v1")];
  const run = (posts: ScoredPost[], folderIds = folder, library = videos) =>
    scoreVideos({ posts, videos: library, folderVideoIds: folderIds, keyOf: (id) => id })[0];

  it("uma conta, um voto: a mediana não deixa um viral carregar o vídeo", () => {
    const result = run([
      vote("a1", "v1", 10),
      vote("a1", "v1", 0.5),
      vote("a1", "v1", 0.5),
      vote("a2", "v1", 0.8),
      vote("a3", "v1", 0.9),
    ]);
    expect(result.votingAccounts).toBe(3);
    expect(result.posts).toBe(5);
    expect(result.score).toBeCloseTo(0.8);
    expect(result.accountsAboveNormal).toBe(0);
    expect(result.status).toBe("below_bar");
  });

  it("passa com 3 contas e score 1,2; 2 contas não bastam", () => {
    expect(run([vote("a1", "v1", 2), vote("a2", "v1", 2)]).status).toBe("few_accounts");
    const passing = run([vote("a1", "v1", 1.2), vote("a2", "v1", 1.2), vote("a3", "v1", 1.5)]);
    expect(passing.score).toBeCloseTo(1.2);
    expect(passing.status).toBe("passes");
    expect(run([vote("a1", "v1", 1.19), vote("a2", "v1", 1.19), vote("a3", "v1", 2)]).status).toBe("below_bar");
  });

  it("fora da pasta e apagado", () => {
    const posts = [vote("a1", "v1", 2), vote("a2", "v1", 2), vote("a3", "v1", 2)];
    const outside = run(posts, []);
    expect(outside.status).toBe("not_in_folder");
    expect(outside.videoId).toBe("v1");
    const removed = run(posts, folder, []);
    expect(removed.status).toBe("removed");
    expect(removed.videoId).toBeNull();
  });

  it("post sem video_id fica fora da nota", () => {
    const list = scoreVideos({
      posts: [scored(makePost({ account: "a1", at: dayAt(2, 10), views: 500, video: null }), 100)],
      videos,
      folderVideoIds: folder,
      keyOf: (id) => id,
    });
    expect(list).toEqual([]);
  });

  it("ranking: score, depois contas votantes, depois mediana de views", () => {
    const library = ["x", "y", "z"].map((id) => makeVideo(id));
    const list = scoreVideos({
      posts: [
        vote("a1", "x", 1.5), vote("a2", "x", 1.5), vote("a3", "x", 1.5),
        vote("a1", "y", 1.5), vote("a2", "y", 1.5), vote("a3", "y", 1.5), vote("a4", "y", 1.5),
        vote("a1", "z", 3), vote("a2", "z", 3), vote("a3", "z", 3),
      ],
      videos: library,
      folderVideoIds: ["x", "y", "z"],
      keyOf: (id) => id,
    });
    expect(list.map((v) => v.videoKey)).toEqual(["z", "y", "x"]);
  });

  it("junta duas importações do mesmo Reel pelo shortcode", () => {
    expect(videoKeyOf("v-a", "https://www.instagram.com/reel/ABC123/")).toBe("ABC123");
    expect(videoKeyOf("v-b", "https://instagram.com/reels/ABC123/?igsh=xyz")).toBe("ABC123");
    expect(videoKeyOf("v-c", null)).toBe("v-c");

    const library = [
      makeVideo("v-a", "https://www.instagram.com/reel/ABC123/"),
      makeVideo("v-b", "https://instagram.com/reels/ABC123/?igsh=xyz"),
    ];
    const posts = [
      vote("a1", "v-a", 2, { key: null }),
      vote("a2", "v-b", 2, { key: null }),
      vote("a3", "v-a", 2, { key: null }),
    ];
    const keyOf = buildVideoKeyResolver(posts.map((sp) => sp.post), library);
    const list = scoreVideos({ posts, videos: library, folderVideoIds: ["v-b"], keyOf });
    expect(list).toHaveLength(1);
    expect(list[0].videoKey).toBe("ABC123");
    expect(list[0].votingAccounts).toBe(3);
    expect(list[0].status).toBe("passes");
    expect(list[0].videoId).toBe("v-b"); // a cópia que está na pasta
  });
});

// ---------------------------------------------------------------------------
// 4. Melhores contas
// ---------------------------------------------------------------------------

describe("melhores contas", () => {
  it("ref = mediana dos normais ≥ 30; boa = ≥ 30 e ≥ 0,5 × ref", () => {
    const accounts = ["a", "b", "c", "d", "e", "f"].map((id) => makeAccount(id));
    accounts.push(makeAccount("g", { isActive: false }));
    accounts.push(makeAccount("h", { healthStatus: "error" }));
    const ranked = rankAccounts({
      accountIds: accounts.map((a) => a.id),
      accounts,
      // ref = mediana(400, 200, 100, 70) = 150 → corte 75. g/h fora do ar não entram no ref.
      normals: fakeNormals({ "ig-a": 400, "ig-b": 200, "ig-c": 100, "ig-d": 70, "ig-e": 20, "ig-f": null, "ig-g": 5000, "ig-h": 900 }),
      postsInQueue: new Map(),
    });
    const status = Object.fromEntries(ranked.map((r) => [r.accountId, r.status]));
    expect(status).toEqual({ a: "good", b: "good", c: "good", d: "weak", e: "weak", f: "no_data", g: "inactive", h: "inactive" });
    expect(ranked.map((r) => r.accountId)).toEqual(["a", "b", "c", "d", "e", "f", "g", "h"]);
  });

  it("todas as contas novas (normal 6) → nenhuma boa → no_accounts", () => {
    const accounts = ["a", "b", "c"].map((id) => makeAccount(id));
    const ranked = rankAccounts({
      accountIds: ["a", "b", "c"],
      accounts,
      normals: fakeNormals({ "ig-a": 6, "ig-b": 6, "ig-c": 7 }),
      postsInQueue: new Map(),
    });
    expect(ranked.every((r) => r.status === "weak")).toBe(true);
    const readiness = computeReadiness({
      queue: makeQueue({ accountIds: ["a", "b", "c"], folderVideoIds: ["v1", "v2", "v3"], videoCountCap: 3 }),
      coverage: { coveredVideos: 3, videosInFewAccounts: 0 },
      passingVideos: 0,
      goodAccounts: ranked.filter((r) => r.status === "good").length,
      accountsWithNormal: ranked.filter((r) => r.status === "good" || r.status === "weak").length,
      awaitingMatureRead: 0,
      nowMs: NOW_MS,
    });
    expect(readiness.state).toBe("no_accounts");
    expect(readiness.message).toBe("Nenhuma conta passou de 30 views por post ainda.");
  });

  it("nenhuma conta com normal (amostra pequena) → no_accounts falando de amostra, não de views", () => {
    const readiness = computeReadiness({
      queue: makeQueue({ accountIds: ["a", "b", "c"], folderVideoIds: ["v1", "v2", "v3"], videoCountCap: 3 }),
      coverage: { coveredVideos: 3, videosInFewAccounts: 0 },
      passingVideos: 0,
      goodAccounts: 0,
      accountsWithNormal: 0,
      awaitingMatureRead: 0,
      nowMs: NOW_MS,
    });
    expect(readiness.state).toBe("no_accounts");
    expect(readiness.message).toBe("As contas ainda não têm 20 posts lidos nos últimos 14 dias para medir o normal.");
  });
});

// ---------------------------------------------------------------------------
// 5. Fila ideal
// ---------------------------------------------------------------------------

describe("fila ideal", () => {
  const base = () =>
    idealInputs({
      videos: [videoScore("v1", 2), videoScore("v2", 1.5)],
      accounts: [accountScore("a1", 100), accountScore("a2", 200), accountScore("a3", null, "no_data")],
      usedVideoIdsByAccount: { a1: ["v1"] },
      repostFactor: 0.5,
      repostPairs: 40,
      currentTypicalPerPost: 120,
      currentMeanVideoScore: 1.25,
      currentMeanAccountNormal: 100,
      currentObservedMedian: 90,
    });

  it("previsão = média da grade N×M com r nos pares já usados; contas sem normal ficam fora", () => {
    const ideal = buildIdealQueue(base(), 2, 3);
    // a1·v1 = 100×2×0,5 · a1·v2 = 150 · a2·v1 = 400 · a2·v2 = 300 → 950 / 4
    expect(ideal.expectedPerPost).toBeCloseTo(237.5);
    expect(ideal.postsPerCycle).toBe(6);
    expect(ideal.alreadyPostedPairs).toBe(1);
    expect(ideal.videosFactor).toBeCloseTo(1.75 / 1.25);
    expect(ideal.accountsFactor).toBeCloseTo(1.5);
    expect(ideal.videoIds).toEqual(["v1", "v2"]);
    expect(ideal.accountIds).toEqual(["a1", "a2", "a3"]);
    expect(ideal.warnings.some((w) => w.includes("repost tem rendido 50% menos"))).toBe(true);
    expect(ideal.warnings.some((w) => w.startsWith("Fila curta"))).toBe(true);
    expect(ideal.warnings).toContain("1 conta abaixo da régua entrou na fila.");
    expect(ideal.text.title).toBe("A sua fila ideal, montada com o que já funciona");
    expect(ideal.text.body).toContain("Cruzei os seus 2 melhores vídeos com as suas 3 melhores contas: 6 publicações por ciclo");
    expect(ideal.text.body).toContain("previsão de 238 views por publicação, contra 120 da fila de hoje (mediana real 90)");
    expect(ideal.text.body).toContain("O ganho vem 1,4× dos vídeos e 1,5× das contas.");
    expect(ideal.text.body).toContain("Nenhuma conta repete o mesmo vídeo no ciclo.");
  });

  it("limita N e M às faixas válidas", () => {
    expect(buildIdealQueue(base(), 10, 0)).toMatchObject({ n: 2, m: 1 });
    expect(buildIdealQueue(base(), -5, 99)).toMatchObject({ n: 1, m: 3 });
    expect(buildIdealQueue(base(), Number.NaN, 2)).toMatchObject({ n: 1, m: 2 });
    const inactive = idealInputs({ ...base(), accounts: [accountScore("x", 500, "inactive"), accountScore("a1", 100)] });
    expect(buildIdealQueue(inactive, 2, 5).accountIds).toEqual(["a1"]);
    const empty = buildIdealQueue(idealInputs(), 3, 3);
    expect(empty).toMatchObject({ n: 0, m: 0, postsPerCycle: 0, expectedPerPost: null });
  });

  it("contagens independem do rodízio: N×M e pares já usados batem com a simulação", () => {
    const videos = ["v1", "v2", "v3"].map((id, i) => videoScore(id, 2 - i * 0.2));
    const accounts = ["a1", "a2", "a3", "a4"].map((id, i) => accountScore(id, 100 + i * 50));
    const used = { a1: ["v1", "v9"], a2: ["v2", "v3"], a4: ["v3"] };
    const grid = gridExpectation(videos, accounts, used, 0.7);
    expect(grid.postsPerCycle).toBe(12);

    // Rodízio do distribute: na rodada k a conta i recebe videoIds[(i + k) mod N].
    const pairs = new Set<string>();
    let repost = 0;
    for (let k = 0; k < videos.length; k++) {
      accounts.forEach((a, i) => {
        const v = videos[(i + k) % videos.length].videoId as string;
        pairs.add(`${a.accountId}|${v}`);
        if ((used as Record<string, string[]>)[a.accountId]?.includes(v)) repost++;
      });
    }
    expect(pairs.size).toBe(12); // nunca 2× no mesmo ciclo
    expect(grid.alreadyPostedPairs).toBe(repost);
    expect(grid.alreadyPostedPairs).toBe(4); // v9 está fora dos N escolhidos

    const shuffled = gridExpectation([...videos].reverse(), [...accounts].reverse(), used, 0.7);
    expect(shuffled.alreadyPostedPairs).toBe(grid.alreadyPostedPairs);
    expect(shuffled.expectedPerPost).toBeCloseTo(grid.expectedPerPost as number);
  });

  it("ritmo, ciclo e stagger herdados", () => {
    const inputs = idealInputs({
      videos: [videoScore("v1", 2), videoScore("v2", 2)],
      accounts: ["a1", "a2", "a3", "a4", "a5"].map((id) => accountScore(id, 100)),
      intervalMinutes: 205,
      postsPerDay: 7,
    });
    const ideal = buildIdealQueue(inputs, 2, 5);
    expect(ideal.postsPerDay).toBe(7);
    expect(ideal.intervalMinutes).toBe(205);
    expect(ideal.cycleMinutes).toBe(410);
    // auto: min(300, floor(0,9 × 205 × 60 / 4)) = 300 → mesmo vídeo a cada 2 × 300 s
    expect(ideal.sameVideoGapSeconds).toBe(600);
    expect(buildIdealQueue({ ...inputs, accountStaggerSeconds: 30 }, 2, 5).sameVideoGapSeconds).toBe(60);
    expect(buildIdealQueue(inputs, 2, 2).sameVideoGapSeconds).toBeNull();
    // ritmo acima de 48/dia é limitado
    expect(buildIdealQueue({ ...inputs, postsPerDay: 0, intervalMinutes: 5 }, 2, 5)).toMatchObject({ postsPerDay: 48, intervalMinutes: 30 });
  });
});

// ---------------------------------------------------------------------------
// 6. Início
// ---------------------------------------------------------------------------

describe("início da fila ideal", () => {
  const bestHour = (hourScores: Record<number, number>) => ({ hour: 19, score: 2, typicalViews: 100, hourScores });

  it("escolhe a fase s que maximiza as horas cobertas (hora sem score = 1,0)", () => {
    const scores = { 19: 2.0, 23: 1.6, 3: 1.4, 10: 0.5 };
    // intervalo 4h, N = 3 → horas s, s+4, s+8
    expect(phaseScore(19, scores, 240, 3)).toBeCloseTo((2 + 1.6 + 1.4) / 3);
    expect(phaseScore(15, scores, 240, 3)).toBeCloseTo((1 + 2 + 1.6) / 3);
    const start = chooseStart({ nowIso: NOW.toISOString(), postsPerDay: 6, intervalMinutes: 240, n: 3, bestHour: bestHour(scores) });
    expect(start.startHour).toBe(19);
    expect(start.startAt).toBe("2026-10-21T22:00:00.000Z"); // 19h BRT de hoje

    // No navegador as chaves de hourScores chegam como texto (JSON): mesmo resultado.
    const fromJson = JSON.parse(JSON.stringify(bestHour(scores)));
    expect(chooseStart({ nowIso: NOW.toISOString(), postsPerDay: 6, intervalMinutes: 240, n: 3, bestHour: fromJson })).toEqual(start);
  });

  it("a próxima s:00 tem que ser ≥ agora + 10 min (senão vai para amanhã)", () => {
    const scores = { 12: 3, 16: 3, 20: 3 };
    const start = chooseStart({ nowIso: NOW.toISOString(), postsPerDay: 6, intervalMinutes: 240, n: 3, bestHour: bestHour(scores) });
    expect(start.startHour).toBe(12);
    expect(start.startAt).toBe("2026-10-22T15:00:00.000Z"); // agora é 12:00 BRT
  });

  it("com 12+ posts/dia ou sem melhor horário: agora + 10 min, múltiplo de 5", () => {
    const nowIso = "2026-10-21T15:03:20.000Z";
    const fast = chooseStart({ nowIso, postsPerDay: 12, intervalMinutes: 120, n: 3, bestHour: bestHour({ 19: 3 }) });
    expect(fast).toEqual({ startAt: "2026-10-21T15:15:00.000Z", startHour: null, phaseScore: null });
    const noHour = chooseStart({ nowIso, postsPerDay: 6, intervalMinutes: 240, n: 3, bestHour: null });
    expect(noHour.startHour).toBeNull();
    expect(noHour.startAt).toBe("2026-10-21T15:15:00.000Z");

    const ideal = buildIdealQueue(
      idealInputs({ videos: [videoScore("v1", 2)], accounts: [accountScore("a1", 100)], postsPerDay: 12, bestHour: bestHour({ 19: 3 }), nowIso }),
      1,
      1,
    );
    expect(ideal.startHour).toBeNull();
    expect(ideal.text.body).toContain("Começa às 12:15 — com 12 posts por dia em cada conta");
  });
});

// ---------------------------------------------------------------------------
// 7. Melhor horário
// ---------------------------------------------------------------------------

describe("melhor horário", () => {
  /** `count` posts maduros na hora BRT `hour`, espalhados entre `accounts` contas. */
  function hourPosts(hour: number, count: number, multiple: number, accounts = 3, views = multiple * 100): ScoredPost[] {
    return Array.from({ length: count }, (_, i) =>
      scored(makePost({ account: `a${i % accounts}`, at: dayAt(2 + (i % 5), hour, i), views, video: `v${i}` }), 100),
    );
  }

  it("qualifica hora com ≥ 10 posts e ≥ 3 contas; melhor ≥ 1,2× a mediana", () => {
    const posts = [
      ...hourPosts(8, 10, 1),
      ...hourPosts(12, 10, 1),
      ...hourPosts(19, 10, 2),
      ...hourPosts(22, 9, 5), // só 9 posts
      ...hourPosts(23, 12, 5, 2), // só 2 contas
    ];
    const best = computeBestHour(posts, new Set());
    expect(best).not.toBeNull();
    expect(best?.hour).toBe(19);
    expect(best?.score).toBe(2);
    expect(Object.keys(best?.hourScores ?? {}).map(Number).sort((a, b) => a - b)).toEqual([8, 12, 19]);
    expect(best?.typicalViews).toBe(200);
  });

  it("menos de 3 horas qualificadas ou ganho < 1,2× → o horário não fez diferença", () => {
    expect(computeBestHour([...hourPosts(8, 10, 1), ...hourPosts(19, 10, 2)], new Set())).toBeNull();
    expect(computeBestHour([...hourPosts(8, 10, 1), ...hourPosts(12, 10, 1), ...hourPosts(19, 10, 1.1)], new Set())).toBeNull();
  });

  it("typicalViews usa as contas boas quando elas têm 5+ posts na hora", () => {
    const posts = [...hourPosts(8, 10, 1), ...hourPosts(12, 10, 1), ...hourPosts(19, 10, 2)];
    // a0 tem 4 posts na hora 19 (i = 0,3,6,9): não basta → fila toda
    expect(computeBestHour(posts, new Set(["a0"]))?.typicalViews).toBe(200);
    // com mais 4 posts de 900 views, a0 tem 8 na hora 19 (4 × 200 e 4 × 900) → mediana só dela = 550
    const extra = Array.from({ length: 4 }, (_, i) =>
      scored(makePost({ account: "a0", at: dayAt(3, 19, 40 + i), views: 900, video: "vx" }), 100),
    );
    expect(computeBestHour([...posts, ...extra], new Set(["a0"]))?.typicalViews).toBe(550);
  });
});

// ---------------------------------------------------------------------------
// 8. Melhor dia
// ---------------------------------------------------------------------------

describe("melhor dia", () => {
  /** 8 posts por conta (3 contas) das 8h às 15h, um por hora. */
  function dayPosts(daysAgo: number, multiple: number, opts: { immature?: number; accounts?: number; perAccount?: number } = {}) {
    const accounts = opts.accounts ?? 3;
    const perAccount = opts.perAccount ?? 8;
    const list: ScoredPost[] = [];
    for (let a = 0; a < accounts; a++) {
      for (let h = 0; h < perAccount; h++) {
        const p = makePost({ account: `a${a}`, at: dayAt(daysAgo, 8 + h), views: multiple * 100, video: `d${daysAgo}-a${a}-h${h}` });
        list.push(scored(p, 100, list.length >= (opts.immature ?? 0)));
      }
    }
    return list;
  }

  it("mínimo de posts = max(20, 50% da mediana diária)", () => {
    expect(bestDayMinPosts([10, 24, 24])).toBe(20);
    expect(bestDayMinPosts([60, 60, 80])).toBe(30);
  });

  it("filtra dias imaturos, pequenos ou com poucas contas; ranking pela mediana do múltiplo", () => {
    const yesterday = dayPosts(1, 1.5);
    // repetição no mesmo dia: a0 posta de novo o vídeo da 8h
    yesterday.push(scored(makePost({ account: "a0", at: dayAt(1, 16), views: 150, video: "d1-a0-h0" }), 100));
    const posts = [
      ...yesterday,
      ...dayPosts(2, 3, { immature: 5 }), // 5 de 24 imaturos (< 90%)
      ...dayPosts(3, 5, { perAccount: 3 }), // 9 posts (< 20)
      ...dayPosts(4, 4, { accounts: 2, perAccount: 12 }), // 2 contas
    ];
    const other = [
      // a1 já tinha usado o vídeo de ontem 5 dias antes, por outra fila
      makePost({ account: "a1", at: dayAt(6, 10), views: 100, video: "d1-a1-h0", queue: "loop-9", source: "loop" }),
      // a2 também postou ontem por outra fila
      makePost({ account: "a2", at: dayAt(1, 20), views: 100, video: "outro", queue: "loop-9", source: "loop" }),
    ];
    const today = [scored(makePost({ account: "a0", at: dayAt(0, 9), views: null, video: "t1" }), 100)];
    const all = [...posts, ...today].map((sp) => sp.post).concat(other);
    const ctx = buildDayPatternContext(all, (p) => p.queueId === QUEUE_ID, false, (id) => id);

    const best = computeBestDay([...posts, ...today], NOW_MS, ctx);
    expect(best?.date).toBe(shiftDay(TODAY, -1));
    expect(best?.medianMultiple).toBe(1.5);
    expect(best).toMatchObject({
      accounts: 3,
      posts: 25,
      medianIntervalMinutes: 60,
      hourFrom: 8,
      hourTo: 15,
      repeatedSameDay: 1,
      repeatedFromBefore: 1,
      accountsAlsoInOtherQueues: 1,
      medianViews: 150,
    });
    expect(best?.today).toMatchObject({ date: TODAY, posts: 1, accounts: 1 });

    const burst = computeBestDay(posts, NOW_MS, { ...ctx, burstMode: true });
    expect(burst?.medianIntervalMinutes).toBeNull();
    expect(burst?.today).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 9. Post bombando
// ---------------------------------------------------------------------------

describe("post bombando agora", () => {
  const accounts = ["a1", "a2", "a3", "a4", "a5"].map((id) => makeAccount(id, id === "a5" ? { isActive: false } : {}));
  const cards = (snapshots: SnapshotRow[] = []): CardContext => ({
    accountById: new Map(accounts.map((a) => [a.id, a])),
    videoById: new Map([["vx", makeVideo("vx")]]),
    snapshotsByPost: new Map(snapshots.map((s) => [`${s.source}:${s.postId}`, [s]])),
  });
  /** 36 posts velhos com 100 views e 4 com 1.500 → p90 da fila = 1.500 com os recentes abaixo. */
  const older = () => [
    ...Array.from({ length: 36 }, (_, i) => scored(makePost({ account: "a2", at: dayAt(5, i % 24), views: 100, video: `o${i}` }), 100)),
    ...Array.from({ length: 4 }, (_, i) => scored(makePost({ account: "a3", at: dayAt(6, i), views: 1500, video: `q${i}` }), 1500)),
  ];
  const recent = (account: string, hoursAgo: number, views: number, normal: number, video = `r${seq}`, source: QueueSource = "postar") =>
    scored(makePost({ account, at: NOW_MS - hoursAgo * HOUR, views, video, source }), normal);

  it("destaque exige ≥ 5× E ≥ p90; ordena por múltiplo e calcula quem pode republicar", () => {
    const top = recent("a1", 20, 3000, 100, "vx"); // 30×
    const posts = [
      ...older(),
      top,
      recent("a2", 10, 2000, 100), // 20×
      recent("a3", 12, 600, 100), // 6× mas abaixo do p90
      recent("a4", 14, 5000, 2000), // muitas views, só 2,5×
      scored(makePost({ account: "a1", at: NOW_MS - 60 * HOUR, views: 9000, video: "old" }), 100), // fora das 48h
    ];
    expect(hotViewsThreshold(posts)).toBe(1500);
    const hot = buildHotSection({
      queue: makeQueue({ accountIds: ["a1", "a2", "a3", "a4", "a5"] }),
      posts,
      nowMs: NOW_MS,
      cards: cards(),
      usedKeysByAccount: new Map([["a2", new Set(["vx"])]]),
      keyOf: (id) => id,
    });
    expect(hot.highlighted.map((c) => c.views)).toEqual([3000, 2000]);
    expect(hot.highlighted[0].multiple).toBe(30);
    expect(hot.fallback).toBeNull();
    expect(hot.republishAccountIds).toEqual(["a3", "a4"]); // a1 postou, a2 já usou, a5 fora do ar
    expect(hot.text.body).toBe(
      "A publicação da @user-a1 já passou de 3.000 visualizações — 30,0× o normal da conta, entre os 10% melhores da fila. Vale colocar esse vídeo nas outras contas.",
    );
  });

  it("post de Loop acrescenta que o Loop já vai levar o vídeo", () => {
    const hot = buildHotSection({
      queue: makeQueue({ source: "loop", accountIds: ["a1"] }),
      posts: [...older(), recent("a1", 20, 3000, 100, "vx", "loop")],
      nowMs: NOW_MS,
      cards: cards(),
      usedKeysByAccount: new Map(),
      keyOf: (id) => id,
    });
    expect(hot.text.body).toContain("O próprio Loop já vai levar esse vídeo às outras contas; o botão antecipa.");
  });

  it("sem destaque: fallback = post maduro de mais views das 48h", () => {
    const hot = buildHotSection({
      queue: makeQueue({ accountIds: ["a1", "a2", "a3", "a4"] }),
      posts: [...older(), recent("a3", 12, 600, 100), recent("a4", 14, 5000, 2000, "vx")],
      nowMs: NOW_MS,
      cards: cards(),
      usedKeysByAccount: new Map(),
      keyOf: (id) => id,
    });
    expect(hot.highlighted).toEqual([]);
    expect(hot.fallback?.views).toBe(5000);
    expect(hot.text.title).toBe("Nenhum post fora da curva nas últimas 48h");
    expect(hot.republishAccountIds).toEqual(["a1", "a2", "a3"]);

    const empty = buildHotSection({
      queue: makeQueue(),
      posts: older(),
      nowMs: NOW_MS,
      cards: cards(),
      usedKeysByAccount: new Map(),
      keyOf: (id) => id,
    });
    expect(empty.fallback).toBeNull();
    expect(empty.republishAccountIds).toEqual([]);
  });

  it("selo 'ainda subindo' compara com a leitura ≥ 3h anterior", () => {
    const at = dayAt(0, 1); // 01:00 BRT de hoje
    const post = makePost({ account: "a1", at, views: 3000, video: "vx", readAfterHours: 10 });
    const snaps: SnapshotRow[] = [
      { postId: post.postId, source: "postar", readAt: iso(at + 6 * HOUR), views: 1500 },
      { postId: post.postId, source: "postar", readAt: iso(at + 9 * HOUR), views: 2800 },
    ];
    // última leitura às 11h; a anterior a ≥ 3h dela é a das 7h (1.500)
    expect(risingTextFor(post, snaps, 100)).toBe("+1.500 views desde a leitura das 7h");
    expect(risingTextFor(post, snaps, 2000)).toBeNull(); // ganho menor que o normal local
    expect(risingTextFor(post, [], 100)).toBeNull(); // sem histórico
    const slow = { ...post, views: 1700 };
    expect(risingTextFor(slow, snaps.slice(0, 1), 100)).toBeNull(); // +13% apenas
  });
});

// ---------------------------------------------------------------------------
// 10. Prontidão
// ---------------------------------------------------------------------------

describe("prontidão", () => {
  const readiness = (queue: QueueConfig, covered: number, passing = 0, good = 0, extra: { few?: number; awaiting?: number } = {}) =>
    computeReadiness({
      queue,
      coverage: { coveredVideos: covered, videosInFewAccounts: extra.few ?? 0 },
      passingVideos: passing,
      goodAccounts: good,
      accountsWithNormal: good,
      awaitingMatureRead: extra.awaiting ?? 0,
      nowMs: NOW_MS,
    });

  it("impossível: Postar com M × cap ÷ pasta < 3; Loop com menos de 3 contas", () => {
    const postar = makeQueue({ accountIds: ["a", "b", "c", "d"], videoCountCap: 2, folderVideoIds: Array.from({ length: 10 }, (_, i) => `v${i}`) });
    expect(isQueueImpossible(postar)).toBe(true); // 4 × 2 / 10 = 0,8
    expect(isQueueImpossible({ ...postar, videoCountCap: 8 })).toBe(false); // 3,2
    expect(isQueueImpossible({ ...postar, videoCountCap: -1 })).toBe(false); // pasta inteira → 4
    expect(isQueueImpossible(makeQueue({ source: "loop", accountIds: ["a", "b"] }))).toBe(true);
    const state = readiness(postar, 0);
    expect(state.state).toBe("impossible");
    expect(state.message).toBe("Essa fila não repete vídeo em 3 contas — a régua não vai fechar.");
  });

  it("coletando com previsão 3 × V × I ÷ M + 4 − horas desde a criação", () => {
    const loop = makeQueue({
      source: "loop",
      accountIds: ["a", "b", "c", "d", "e"],
      folderVideoIds: Array.from({ length: 10 }, (_, i) => `v${i}`),
      intervalMinutes: 60,
      createdAt: iso(NOW_MS - 2 * HOUR),
    });
    expect(collectingEtaHours(loop, NOW_MS)).toBe(8); // 3 × 10 × 1 / 5 + 4 − 2
    const state = readiness(loop, 1, 0, 0, { few: 4, awaiting: 7 });
    expect(state.state).toBe("collecting");
    expect(state.etaHours).toBe(8);
    expect(state.message).toBe(
      "Coletando dados: 1 vídeo já rodou em 3+ contas com leitura de 4h (precisa de 3). 4 vídeos estão em 1–2 contas e 7 posts aguardam a leitura de 4h. Previsão: ~8h.",
    );
    // fila antiga: o prazo já passou sem cobertura → sem previsão (não promete "nas próximas horas")
    expect(collectingEtaHours({ ...loop, createdAt: iso(NOW_MS - 100 * HOUR) }, NOW_MS)).toBeNull();
    // fila pausada ou terminada: sem previsão
    expect(collectingEtaHours({ ...loop, state: "paused" }, NOW_MS)).toBeNull();
    expect(collectingEtaHours({ ...loop, state: "finished" }, NOW_MS)).toBeNull();
    // Modo Ciclo: sem previsão
    const burst = readiness({ ...loop, source: "postar", burstMode: true, intervalMinutes: null }, 2);
    expect(burst.etaHours).toBeNull();
    expect(burst.message).not.toContain("Previsão");
  });

  it("no_accounts, few_good e ready", () => {
    const queue = makeQueue({ accountIds: ["a", "b", "c"], folderVideoIds: ["v1", "v2", "v3"], videoCountCap: 3 });
    expect(readiness(queue, 3, 3, 0).state).toBe("no_accounts");
    const few = readiness(queue, 4, 2, 2);
    expect(few.state).toBe("few_good");
    expect(few.message).toBe("Já dá para comparar 4 vídeos, mas só 2 estão acima do normal das contas — a fila ideal precisa de 3.");
    expect(readiness(queue, 4, 3, 1).state).toBe("ready");
  });

  it("cobertura conta contas distintas com post maduro", () => {
    const posts = [
      vote("a1", "v1", 1), vote("a2", "v1", 1), vote("a3", "v1", 1),
      vote("a1", "v2", 1), vote("a1", "v2", 1),
      scored(makePost({ account: "a1", at: NOW_MS - 2 * HOUR, views: 10, video: "v3" }), 100), // imaturo
    ];
    expect(videoCoverage(posts, (id) => id)).toEqual({ coveredVideos: 1, videosInFewAccounts: 1 });
  });
});

// ---------------------------------------------------------------------------
// 11. Intervalo herdado e fator de repost
// ---------------------------------------------------------------------------

describe("intervalo herdado", () => {
  const at = (account: string, minutes: number[]) =>
    minutes.map((m) => makePost({ account, at: dayAt(3, 8) + m * MIN, views: 100, video: `v${m}` }));

  it("Modo Ciclo mede nos posts: mediana entre contas da mediana dos intervalos de cada conta", () => {
    const posts = [
      ...at("a1", [0, 60, 120, 210]), // 60, 60, 90 → 60
      ...at("a2", [0, 90, 180]), // 90
      ...at("a3", [0, 120]), // 120
      ...at("a4", [0]), // 1 post: não mede
    ];
    expect(medianAccountGapMinutes(posts)).toBe(90);
    const queue = makeQueue({ burstMode: true, intervalMinutes: null, postsPerDay: null });
    expect(inheritedIntervalMinutes(queue, posts)).toBe(90);
  });

  it("Postar normal usa floor(1440 / posts_per_day); Loop usa interval_minutes", () => {
    expect(inheritedIntervalMinutes(makeQueue({ postsPerDay: 7, intervalMinutes: 205 }), [])).toBe(205);
    expect(inheritedIntervalMinutes(makeQueue({ source: "loop", postsPerDay: 32, intervalMinutes: 45 }), [])).toBe(45);
  });

  it("fator de repost só vale com 30+ pares", () => {
    const normalsPosts = (account: string) => history(account, 2, 30, 100, 0);
    const pairPosts = (account: string, video: string) => [
      makePost({ account, at: dayAt(2, 6), views: 200, video, queue: null }),
      makePost({ account, at: dayAt(2, 7), views: 100, video, queue: null }),
    ];
    const accountsList = Array.from({ length: 30 }, (_, i) => `a${i}`);
    const posts = accountsList.flatMap((a) => [...normalsPosts(a), ...pairPosts(a, "rv")]);
    const normals = buildNormals(posts, NOW);
    expect(computeRepostFactor(posts, normals, (id) => id, NOW_MS)).toEqual({ factor: 0.5, pairs: 30 });
    const fewer = posts.filter((p) => p.accountId !== "a0");
    expect(computeRepostFactor(fewer, buildNormals(fewer, NOW), (id) => id, NOW_MS)).toEqual({ factor: 1, pairs: 29 });
  });
});

// ---------------------------------------------------------------------------
// 12. Ponta a ponta
// ---------------------------------------------------------------------------

describe("analyzeQueue", () => {
  function scenario(): AnalyzeInput {
    const ids = ["a1", "a2", "a3", "a4"];
    const accountPosts: PostRow[] = [];
    // Histórico fora da fila: 4 posts/dia de 100 views nos últimos 10 dias → normal 100.
    for (const a of ids) {
      for (let d = 1; d <= 10; d++) {
        for (const h of [9, 12, 15, 18]) {
          accountPosts.push(makePost({ account: a, at: dayAt(d, h), views: 100, video: `h-${a}-${d}-${h}`, queue: "loop-x", source: "loop" }));
        }
      }
    }
    // Fila: v1..v3 rendem 2× em todas as contas, v4 rende 1×, há 3 dias.
    const queuePosts: PostRow[] = [];
    for (const a of ids) {
      [["v1", 10, 200], ["v2", 11, 200], ["v3", 13, 200], ["v4", 14, 100]].forEach(([v, h, views]) => {
        queuePosts.push(makePost({ account: a, at: dayAt(3, h as number), views: views as number, video: v as string }));
      });
    }
    return {
      queue: makeQueue({
        accountIds: [...ids, "a5"],
        folderVideoIds: ["v1", "v2", "v3", "v4"],
        videoCountCap: 4,
        postsPerDay: 24,
      }),
      queuePosts,
      accountPosts: [...accountPosts, ...queuePosts],
      accounts: [...ids.map((id) => makeAccount(id)), makeAccount("a5", { isActive: false })],
      videos: ["v1", "v2", "v3", "v4"].map((id) => makeVideo(id)),
      snapshots: [],
      usedVideoIdsByAccount: {},
      missingSql: ["post_views_snapshots"],
    };
  }

  it("monta a fila ideal quando a régua fecha", () => {
    const result = analyzeQueue(scenario(), NOW);
    expect(result.generatedAt).toBe(NOW.toISOString());
    expect(result.missingSql).toEqual(["post_views_snapshots"]);
    expect(result.summary).toMatchObject({ windowDays: 30, posts: 16, totalViews: 2800, medianViews: 200 });

    expect(result.videos.map((v) => [v.videoKey, v.status, v.score, v.votingAccounts])).toEqual([
      ["v1", "passes", 2, 4],
      ["v2", "passes", 2, 4],
      ["v3", "passes", 2, 4],
      ["v4", "below_bar", 1, 4],
    ]);
    expect(result.accounts.map((a) => [a.accountId, a.status, a.currentNormal])).toEqual([
      ["a1", "good", 100],
      ["a2", "good", 100],
      ["a3", "good", 100],
      ["a4", "good", 100],
      ["a5", "inactive", null],
    ]);
    expect(result.readiness.state).toBe("ready");
    expect(result.hot.highlighted).toEqual([]);
    expect(result.hot.fallback).toBeNull();
    expect(result.bestHour).toBeNull();
    expect(result.bestDay).toBeNull();

    const inputs = result.idealInputs;
    expect(inputs).toMatchObject({ defaultN: 3, defaultM: 4, maxN: 4, intervalMinutes: 60, postsPerDay: 24, repostFactor: 1 });
    expect(inputs.accounts.map((a) => a.accountId)).toEqual(["a1", "a2", "a3", "a4"]);
    expect(inputs.usedVideoIdsByAccount.a1).toEqual(["v1", "v2", "v3"]);
    // fila de hoje: (12 × 100×2 + 4 × 100×1) / 16
    expect(inputs.currentTypicalPerPost).toBeCloseTo(175);
    expect(inputs.currentMeanVideoScore).toBeCloseTo(1.75);
    expect(inputs.currentObservedMedian).toBe(200);

    const ideal = result.ideal;
    expect(ideal).not.toBeNull();
    expect(ideal).toMatchObject({
      n: 3,
      m: 4,
      videoIds: ["v1", "v2", "v3"],
      postsPerCycle: 12,
      alreadyPostedPairs: 12,
      expectedPerPost: 200,
      accountsFactor: 1,
      startHour: null,
    });
    expect(ideal?.videosFactor).toBeCloseTo(2 / 1.75);

    // O painel recalcula no navegador a partir do JSON: mesmo resultado.
    const roundTrip = buildIdealQueue(JSON.parse(JSON.stringify(inputs)), inputs.defaultN, inputs.defaultM);
    expect(roundTrip).toEqual(ideal);
  });

  it("sem régua fechada não calcula a fila ideal", () => {
    const input = scenario();
    input.queuePosts = input.queuePosts.filter((p) => p.accountId === "a1" || p.accountId === "a2");
    input.accountPosts = input.accountPosts.filter((p) => p.queueId !== QUEUE_ID || p.accountId === "a1" || p.accountId === "a2");
    const result = analyzeQueue(input, NOW);
    expect(result.readiness.state).toBe("collecting");
    expect(result.ideal).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Formatação
// ---------------------------------------------------------------------------

describe("formatação pt-BR", () => {
  it("milhar com ponto e decimal com vírgula", () => {
    expect(fmtInt(1234)).toBe("1.234");
    expect(fmtInt(1234567.4)).toBe("1.234.567");
    expect(fmtMultiple(1.25)).toBe("1,3×");
    expect(fmtMultiple(1234.5)).toBe("1.234,5×");
  });
});
