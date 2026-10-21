import { describe, it, expect } from "vitest";
import { assignRotation } from "../lib/media-priority";

/**
 * Rodízio da fila ideal (docs/fila-ideal.md §12): na rodada k a conta da
 * posição i recebe videoIds[(i + k) mod N]. Repost permitido, nunca o mesmo
 * vídeo 2× para a mesma conta no ciclo.
 */

function sequenceByAccount(results: { accountId: string; video: { id: string } }[]) {
  const seq = new Map<string, string[]>();
  for (const r of results) {
    const list = seq.get(r.accountId) ?? [];
    list.push(r.video.id);
    seq.set(r.accountId, list);
  }
  return seq;
}

const videos = (n: number) => Array.from({ length: n }, (_, i) => `v${i + 1}`);
const accounts = (m: number) => Array.from({ length: m }, (_, i) => `a${i + 1}`);

describe("assignRotation", () => {
  it("cada conta recebe cada vídeo exatamente uma vez", () => {
    const v = videos(5);
    const a = accounts(4);
    const result = assignRotation(a, v);
    expect(result).toHaveLength(5 * 4);

    const seq = sequenceByAccount(result);
    expect([...seq.keys()]).toEqual(a);
    for (const acc of a) {
      const list = seq.get(acc)!;
      expect(list).toHaveLength(5);
      expect(new Set(list).size).toBe(5);
      expect([...list].sort()).toEqual([...v].sort());
    }
  });

  it("a ordem gira: conta i começa no vídeo i e segue em ordem", () => {
    const seq = sequenceByAccount(assignRotation(["a", "b", "c"], ["v1", "v2", "v3"]));
    expect(seq.get("a")).toEqual(["v1", "v2", "v3"]);
    expect(seq.get("b")).toEqual(["v2", "v3", "v1"]);
    expect(seq.get("c")).toEqual(["v3", "v1", "v2"]);
  });

  it("cada rodada usa vídeos distintos enquanto M ≤ N", () => {
    const a = accounts(3);
    const result = assignRotation(a, videos(6));
    for (let k = 0; k < 6; k++) {
      const round = result.slice(k * a.length, (k + 1) * a.length);
      expect(round.map((r) => r.accountId)).toEqual(a);
      expect(new Set(round.map((r) => r.video.id)).size).toBe(a.length);
    }
  });

  it("M > N: a conta i e a conta i+N seguem a mesma sequência", () => {
    const v = videos(3);
    const a = accounts(7);
    const seq = sequenceByAccount(assignRotation(a, v));
    for (let i = 0; i < a.length; i++) {
      const list = seq.get(a[i])!;
      expect(list).toEqual([0, 1, 2].map((k) => v[(i + k) % 3]));
      expect(new Set(list).size).toBe(3);
      if (i + 3 < a.length) expect(seq.get(a[i + 3])).toEqual(list);
    }
  });

  it("N = 1: cada conta posta o único vídeo uma vez", () => {
    const result = assignRotation(accounts(4), ["unico"]);
    expect(result).toHaveLength(4);
    expect(result.every((r) => r.video.id === "unico")).toBe(true);
    expect(result.map((r) => r.accountId)).toEqual(accounts(4));
  });

  it("ignora o histórico: nunca marca reset de ciclo", () => {
    expect(assignRotation(accounts(2), videos(2)).every((r) => r.isCycleReset === false)).toBe(true);
  });

  it("listas vazias → nenhuma atribuição", () => {
    expect(assignRotation([], videos(3))).toEqual([]);
    expect(assignRotation(accounts(3), [])).toEqual([]);
  });

  it("ids repetidos não fazem a conta repetir vídeo", () => {
    const seq = sequenceByAccount(assignRotation(["a", "b", "a"], ["v1", "v2", "v1"]));
    expect([...seq.keys()]).toEqual(["a", "b"]);
    expect(seq.get("a")).toEqual(["v1", "v2"]);
    expect(seq.get("b")).toEqual(["v2", "v1"]);
  });

  it("é determinístico", () => {
    expect(assignRotation(accounts(5), videos(4))).toEqual(assignRotation(accounts(5), videos(4)));
  });
});
