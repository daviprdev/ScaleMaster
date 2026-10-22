import { describe, it, expect } from "vitest";
import {
  buildAccountQueues,
  isBusyElsewhere,
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

function loop(extra: Partial<QueueLoop> = {}): QueueLoop {
  return { id: "loop1", label: "Loop · Vitória", accountFolderId: null, accountIds: [], recentAccountIds: new Set(), ...extra };
}

const ids = (r: Record<string, unknown>) => Object.keys(r).sort();

describe("buildAccountQueues — Postar", () => {
  it("conta com post pendente está em fila; quem terminou a campanha não", () => {
    const r = buildAccountQueues([acc("a"), acc("b")], [campaign({ states: [["a", 88, 3], ["b", 88, 0]] })], []);
    expect(ids(r)).toEqual(["a"]);
    expect(r.a).toEqual([{ source: "postar", id: "camp", label: "Postar · pasta VITORIAOFZ", enrolled: true }]);
  });

  it("sincronizada: entre um post e outro segue matriculada; conta ativa sem post está a caminho", () => {
    const r = buildAccountQueues(
      [acc("entre-posts"), acc("nova-ativa"), acc("acabou")],
      [campaign({ accountFolderIds: [PASTA], states: [["entre-posts", 10, 0], ["acabou", 88, 0]] })],
      [],
    );
    expect(ids(r)).toEqual(["entre-posts", "nova-ativa"]);
    expect(r["entre-posts"][0].enrolled).toBe(true);
    expect(r["nova-ativa"][0].enrolled).toBe(false);
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

  it("conta nova já numa fila nova não aparece como a caminho da sincronizada antiga", () => {
    const antiga = campaign({ id: "antiga", accountFolderIds: [PASTA], states: [["velha", 40, 1]] });
    const nova = campaign({ id: "nova", label: "Postar · pasta VITORIAOFZ (nova)", states: [["nova", 88, 88]] });
    const r = buildAccountQueues([acc("velha"), acc("nova")], [antiga, nova], []);
    expect(r.nova.map((q) => q.id)).toEqual(["nova"]);
    expect(r.velha.map((q) => q.id)).toEqual(["antiga"]);
  });
});

describe("buildAccountQueues — Loop", () => {
  it("modo pasta: conta que postou nos últimos 2 dias está matriculada; ativa sem post está a caminho", () => {
    const r = buildAccountQueues(
      [acc("postou"), acc("a-caminho"), acc("inativa", { isActive: false }), acc("fora", { folderId: null })],
      [],
      [loop({ accountFolderId: PASTA, recentAccountIds: new Set(["postou"]) })],
    );
    expect(ids(r)).toEqual(["a-caminho", "postou"]);
    expect(r.postou[0].enrolled).toBe(true);
    expect(r["a-caminho"][0].enrolled).toBe(false);
  });

  it("contas específicas: só as do usuário, sem repetir, sempre matriculadas", () => {
    const r = buildAccountQueues([acc("b")], [], [loop({ id: "loop2", label: "Loop · Teste", accountIds: ["b", "b", "alheia"] })]);
    expect(r).toEqual({ b: [{ source: "loop", id: "loop2", label: "Loop · Teste", enrolled: true }] });
  });

  it("conta já numa campanha não aparece a caminho do Loop por pasta", () => {
    const r = buildAccountQueues([acc("a")], [campaign({ states: [["a", 5, 1]] })], [loop({ accountFolderId: PASTA })]);
    expect(r.a.map((q) => q.source)).toEqual(["postar"]);
  });

  it("conta matriculada em duas filas lista as duas", () => {
    const r = buildAccountQueues(
      [acc("a")],
      [campaign({ states: [["a", 5, 1]] })],
      [loop({ accountFolderId: PASTA, recentAccountIds: new Set(["a"]) })],
    );
    expect(r.a.map((q) => q.source)).toEqual(["postar", "loop"]);
  });
});

describe("isBusyElsewhere", () => {
  const nova = { source: "postar" as const, id: "nova", label: "x", enrolled: true };
  const antigaACaminho = { source: "postar" as const, id: "antiga", label: "y", enrolled: false };

  it("barra quem já posta por outra fila", () => {
    expect(isBusyElsewhere([nova, antigaACaminho], { source: "postar", id: "antiga" })).toBe(true);
  });

  it("a própria fila e as filas só a caminho não contam", () => {
    expect(isBusyElsewhere([nova], { source: "postar", id: "nova" })).toBe(false);
    expect(isBusyElsewhere([antigaACaminho], { source: "loop", id: "loop1" })).toBe(false);
    expect(isBusyElsewhere(undefined, { source: "postar", id: "antiga" })).toBe(false);
  });

  it("mesma id em fonte diferente é outra fila", () => {
    expect(isBusyElsewhere([{ ...nova, id: "x" }], { source: "loop", id: "x" })).toBe(true);
  });
});
