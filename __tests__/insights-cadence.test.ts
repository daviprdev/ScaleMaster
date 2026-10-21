import { describe, it, expect } from "vitest";
import {
  D,
  H,
  MIN,
  LOOP_DATE,
  POSTAR_DATE,
  classifyReel,
  classifyStory,
  planBatch,
  reelAgeDate,
  reelEligibilityFilter,
  type Prioritized,
  type Tier,
} from "../lib/insights-cadence";

const NOW = Date.parse("2026-10-21T15:00:00.000Z");
const ago = (ms: number) => new Date(NOW - ms).toISOString();

/** Reel publicado há `age`, lido pela última vez há `read` (null = nunca). */
const tierOf = (age: number, read: number | null) =>
  classifyReel(ago(age), read === null ? null : ago(read), NOW)?.tier ?? null;

describe("classifyReel — faixas por idade", () => {
  it("nunca lido: espera 15 min antes da 1ª leitura", () => {
    expect(tierOf(2 * MIN, null)).toBeNull();
    expect(tierOf(15 * MIN - 1, null)).toBeNull();
    expect(tierOf(15 * MIN, null)).toBe("new");
    expect(tierOf(3 * H, null)).toBe("new");
  });

  it("nunca lido de qualquer idade ainda é lido uma vez (como antes)", () => {
    expect(tierOf(10 * D, null)).toBe("new");
    expect(tierOf(90 * D, null)).toBe("new");
  });

  it("< 2h: relê a cada 30 min", () => {
    expect(tierOf(40 * MIN, 30 * MIN)).toBeNull();
    expect(tierOf(40 * MIN, 30 * MIN + 1)).toBe("30m");
    expect(tierOf(2 * H - 1, 31 * MIN)).toBe("30m");
  });

  it("2–6h: relê a cada 1h", () => {
    expect(tierOf(2 * H, 31 * MIN)).toBeNull();
    expect(tierOf(2 * H, H)).toBeNull();
    expect(tierOf(2 * H, H + 1)).toBe("1h");
    expect(tierOf(6 * H - 1, H + 1)).toBe("1h");
  });

  it("6h–2 dias: relê a cada 4h", () => {
    expect(tierOf(6 * H, H + 1)).toBeNull();
    expect(tierOf(6 * H, 4 * H + 1)).toBe("4h");
    expect(tierOf(2 * D - 1, 4 * H + 1)).toBe("4h");
  });

  it("2–14 dias diário, 14–60 dias semanal, > 60 dias nunca", () => {
    expect(tierOf(2 * D, 5 * H)).toBeNull();
    expect(tierOf(2 * D, D + 1)).toBe("1d");
    expect(tierOf(14 * D - 1, D + 1)).toBe("1d");
    expect(tierOf(14 * D, 6 * D)).toBeNull();
    expect(tierOf(14 * D, 7 * D + 1)).toBe("7d");
    expect(tierOf(60 * D - 1, 7 * D + 1)).toBe("7d");
    expect(tierOf(60 * D, 30 * D)).toBeNull();
  });

  it("atraso = tempo além do intervalo", () => {
    expect(classifyReel(ago(H), ago(50 * MIN), NOW)?.overdueMs).toBe(20 * MIN);
    expect(classifyReel(ago(20 * MIN), null, NOW)?.overdueMs).toBe(5 * MIN);
  });

  it("sem data não entra", () => {
    expect(classifyReel(null, null, NOW)).toBeNull();
  });

  it("aceita o timestamptz do PostgREST (microssegundos e offset)", () => {
    expect(classifyReel("2026-10-21T14:40:00.123456+00:00", null, NOW)?.tier).toBe("new");
    expect(classifyReel("2026-10-21T14:00:00.5+00:00", "2026-10-21T14:20:00.654321+00:00", NOW)?.tier).toBe("30m");
  });
});

describe("reelAgeDate — Loop usa published_at e cai para created_at", () => {
  const pub = ago(H);
  const created = ago(5 * H);

  it("Loop com published_at usa published_at", () => {
    expect(reelAgeDate({ published_at: pub, created_at: created }, LOOP_DATE)).toBe(pub);
  });

  it("Loop antigo sem published_at usa created_at", () => {
    expect(reelAgeDate({ published_at: null, created_at: created }, LOOP_DATE)).toBe(created);
    expect(reelAgeDate({ created_at: created }, LOOP_DATE)).toBe(created);
  });

  it("Postar não tem reserva", () => {
    expect(reelAgeDate({ published_at: null, created_at: created }, POSTAR_DATE)).toBeNull();
    expect(reelAgeDate({ published_at: pub }, POSTAR_DATE)).toBe(pub);
  });

  it("a faixa do Loop muda conforme a data usada", () => {
    // Publicado há 1h (criado há 5h), lido há 45 min: devido pela faixa de 30 min.
    const row = { published_at: pub, created_at: created };
    expect(classifyReel(reelAgeDate(row, LOOP_DATE), ago(45 * MIN), NOW)?.tier).toBe("30m");
    // Pela created_at (5h) ainda não estaria devido (faixa de 1h).
    expect(classifyReel(created, ago(45 * MIN), NOW)).toBeNull();
  });
});

describe("reelEligibilityFilter — filtro do banco", () => {
  it("jovens do Postar: nunca lido 15 min+ e as três faixas < 2 dias", () => {
    const f = reelEligibilityFilter("young", POSTAR_DATE, NOW);
    expect(f).toContain(`and(insights_fetched_at.is.null,published_at.lte.${ago(15 * MIN)},published_at.gt.${ago(2 * D)})`);
    expect(f).toContain(`and(published_at.lte.${ago(0)},published_at.gt.${ago(2 * H)},insights_fetched_at.lt.${ago(30 * MIN)})`);
    expect(f).toContain(`and(published_at.lte.${ago(2 * H)},published_at.gt.${ago(6 * H)},insights_fetched_at.lt.${ago(H)})`);
    expect(f).toContain(`and(published_at.lte.${ago(6 * H)},published_at.gt.${ago(2 * D)},insights_fetched_at.lt.${ago(4 * H)})`);
    expect(f).not.toContain(ago(14 * D));
    expect(f).not.toContain("created_at");
  });

  it("antigos do Postar: diário, semanal e nunca lido de 2 dias+", () => {
    const f = reelEligibilityFilter("old", POSTAR_DATE, NOW);
    expect(f).toContain(`and(insights_fetched_at.is.null,published_at.lte.${ago(2 * D)})`);
    expect(f).toContain(`and(published_at.lte.${ago(2 * D)},published_at.gt.${ago(14 * D)},insights_fetched_at.lt.${ago(D)})`);
    expect(f).toContain(`and(published_at.lte.${ago(14 * D)},published_at.gt.${ago(60 * D)},insights_fetched_at.lt.${ago(7 * D)})`);
    expect(f).not.toContain(ago(30 * MIN));
  });

  it("Loop monta os dois ramos: published_at e created_at onde published_at é nulo", () => {
    const f = reelEligibilityFilter("young", LOOP_DATE, NOW);
    const branches = f.split(/,(?=and\()/);
    expect(branches).toHaveLength(8);
    expect(branches.filter((b) => b.includes("published_at.lte."))).toHaveLength(4);
    const fallback = branches.filter((b) => b.includes("created_at."));
    expect(fallback).toHaveLength(4);
    for (const b of fallback) expect(b.startsWith("and(published_at.is.null,")).toBe(true);
    expect(f).toContain(
      `and(published_at.is.null,created_at.lte.${ago(2 * H)},created_at.gt.${ago(6 * H)},insights_fetched_at.lt.${ago(H)})`
    );
  });
});

describe("planBatch — prioridade e anti-fome", () => {
  let seq = 0;
  const item = (tier: Tier, overdueMs = 0, key = `k${seq++}`): Prioritized => ({ key, tier, overdueMs });

  it("stories → nunca lidos → jovens → antigos", () => {
    const items = [item("7d", 9 * D), item("1d", 3 * D), item("4h", MIN), item("new", 0), item("story", 0), item("30m", MIN)];
    const { batch } = planBatch(items, 10);
    // Antigos atrás de tudo, mesmo muito mais atrasados; entre eles, o mais atrasado primeiro.
    expect(batch.map((b) => b.tier)).toEqual(["story", "new", "4h", "30m", "7d", "1d"]);
  });

  it("antigos nunca tiram jovens do lote quando falta capacidade", () => {
    const old = Array.from({ length: 300 }, () => item("7d", 30 * D));
    const young = Array.from({ length: 120 }, (_, i) => item(i % 2 ? "30m" : "1h", MIN));
    const { batch, leftover, candidates } = planBatch([...old, ...young], 150);
    expect(batch).toHaveLength(150);
    expect(batch.slice(0, 120).every((b) => b.tier === "30m" || b.tier === "1h")).toBe(true);
    expect(batch.slice(120).every((b) => b.tier === "7d")).toBe(true);
    expect(candidates).toBe(420);
    expect(leftover).toBe(270);
  });

  it("dentro das faixas jovens, o mais atrasado primeiro", () => {
    const { batch } = planBatch([item("30m", 5 * MIN, "a"), item("4h", 40 * MIN, "b"), item("1h", 20 * MIN, "c")], 10);
    expect(batch.map((b) => b.key)).toEqual(["b", "c", "a"]);
  });

  it("story nunca lido vem antes de story lido", () => {
    const read = { key: "lido", ...classifyStory(ago(3 * H), NOW) };
    const never = { key: "nunca", ...classifyStory(null, NOW) };
    expect(planBatch([read, never], 10).batch.map((b) => b.key)).toEqual(["nunca", "lido"]);
  });

  it("conta por faixa, sobra e remove duplicados", () => {
    const items = [item("story"), item("new"), item("30m", 0, "dup"), item("30m", 0, "dup"), item("1d")];
    const { byTier, leftover, candidates, batch } = planBatch(items, 2);
    expect(byTier).toEqual({ story: 1, new: 1, "30m": 1, "1h": 0, "4h": 0, "1d": 1, "7d": 0 });
    expect(candidates).toBe(4);
    expect(batch).toHaveLength(2);
    expect(leftover).toBe(2);
  });

  it("sem candidatos: lote vazio e sobra zero", () => {
    expect(planBatch([], 500)).toMatchObject({ batch: [], leftover: 0, candidates: 0 });
  });
});
