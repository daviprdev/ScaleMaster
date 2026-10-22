import { describe, it, expect } from "vitest";
import {
  buildAccountQueues,
  type QueueAccount,
  type QueueCampaign,
  type QueueLoop,
} from "../lib/fila/account-queues";

const PASTA = "pasta-vitoria";

function acc(id: string, extra: Partial<QueueAccount> = {}): QueueAccount {
  return { id, folderId: PASTA, isActive: true, healthStatus: "online", ...extra };
}

/** states: [conta, posts no total, posts em voo]. */
function campaign(
  extra: Omit<Partial<QueueCampaign>, "states"> & { states?: [string, number, number][] } = {},
): QueueCampaign {
  const { states = [], ...rest } = extra;
  return {
    id: "camp",
    label: "Postar · pasta VITORIAOFZ",
    accountFolderIds: [],
    burstMode: false,
    maxVideos: 88,
    ...rest,
    states: new Map(states.map(([id, total, inflight]) => [id, { total, inflight }])),
  };
}

const ids = (r: Record<string, unknown>) => Object.keys(r).sort();

describe("buildAccountQueues — Postar", () => {
  it("conta com post pendente está em fila; quem terminou a campanha não", () => {
    const r = buildAccountQueues(
      [acc("a"), acc("b")],
      [campaign({ states: [["a", 88, 3], ["b", 88, 0]] })],
      [],
    );
    expect(ids(r)).toEqual(["a"]);
    expect(r.a).toEqual([{ source: "postar", id: "camp", label: "Postar · pasta VITORIAOFZ" }]);
  });

  it("sincronizada: conta ativa da pasta conta mesmo entre um post e outro e antes do 1º post", () => {
    const r = buildAccountQueues(
      [acc("entre-posts"), acc("nova-ativa"), acc("acabou")],
      [campaign({ accountFolderIds: [PASTA], states: [["entre-posts", 10, 0], ["acabou", 88, 0]] })],
      [],
    );
    expect(ids(r)).toEqual(["entre-posts", "nova-ativa"]);
  });

  it("sincronizada: conta nova inativa ou com erro fica livre (o cron não puxa)", () => {
    const r = buildAccountQueues(
      [acc("inativa", { isActive: false }), acc("sem-flag", { isActive: null }), acc("caiu", { healthStatus: "error" })],
      [campaign({ accountFolderIds: [PASTA] })],
      [],
    );
    expect(ids(r)).toEqual([]);
  });

  it("sincronizada não puxa conta de outra pasta; modo ciclo não sincroniza", () => {
    const r = buildAccountQueues(
      [acc("outra", { folderId: "pasta-bianca" }), acc("ciclo")],
      [campaign({ accountFolderIds: [PASTA], burstMode: true })],
      [],
    );
    expect(ids(r)).toEqual([]);
  });

  it("sem teto conhecido, conta ativa da pasta sincronizada fica em fila", () => {
    const r = buildAccountQueues([acc("a")], [campaign({ accountFolderIds: [PASTA], maxVideos: null, states: [["a", 500, 0]] })], []);
    expect(ids(r)).toEqual(["a"]);
  });
});

describe("buildAccountQueues — Loop", () => {
  const loopPasta: QueueLoop = { id: "loop1", label: "Loop · Vitória", accountFolderId: PASTA, accountIds: [] };
  const loopContas: QueueLoop = { id: "loop2", label: "Loop · Teste", accountFolderId: null, accountIds: ["b", "b", "alheia"] };

  it("modo pasta: contas ativas e sem erro da pasta", () => {
    const r = buildAccountQueues([acc("a"), acc("inativa", { isActive: false }), acc("fora", { folderId: null })], [], [loopPasta]);
    expect(ids(r)).toEqual(["a"]);
  });

  it("contas específicas: só as do usuário, sem repetir", () => {
    const r = buildAccountQueues([acc("b")], [], [loopContas]);
    expect(r).toEqual({ b: [{ source: "loop", id: "loop2", label: "Loop · Teste" }] });
  });

  it("conta em duas filas lista as duas", () => {
    const r = buildAccountQueues([acc("a")], [campaign({ states: [["a", 5, 1]] })], [loopPasta]);
    expect(r.a.map((q) => q.source)).toEqual(["postar", "loop"]);
  });
});
