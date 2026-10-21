/**
 * lib/insights-cadence.ts — Quando reler as métricas de cada post publicado
 * (cron app/api/cron/sync-post-insights). Funções puras, testadas em
 * __tests__/insights-cadence.test.ts.
 *
 * Reel, pela idade desde a publicação:
 *   Nunca lido   → 1ª leitura com 15 min+ (aos ~2 min a Meta devolve ≈0 views;
 *                  melhor não mostrar nada do que um 0 falso por horas)
 *   < 2h         → a cada 30 min
 *   2–6h         → a cada 1h
 *   6h–2 dias    → a cada 4h
 *   2–14 dias    → a cada 24h
 *   14–60 dias   → a cada 7 dias
 *   > 60 dias    → não atualiza mais
 * Story < 26h → a cada 1h, nunca lido → imediato (a Meta só expõe story ativo).
 *
 * Idade: Postar conta de published_at; Loop de published_at e, nas linhas
 * antigas sem ele (antes de fila_ideal.sql), de created_at.
 *
 * Anti-fome: cada origem de reel faz duas consultas — jovens (< 2 dias) e
 * antigos (2+ dias) — para que as linhas diárias/semanais (insights_fetched_at
 * mais velho) não ocupem o limite da consulta e deixem as releituras novas de
 * fora. O lote junta tudo com prioridade explícita: stories → nunca lidos →
 * faixas jovens → faixas antigas; dentro de cada grupo, o mais atrasado primeiro.
 */

export const MIN = 60 * 1000;
export const H = 60 * MIN;
export const D = 24 * H;

/** Idade mínima para a 1ª leitura de um reel. */
export const FIRST_READ_MIN_AGE = 15 * MIN;
/** Fronteira entre a consulta de jovens e a de antigos. */
export const YOUNG_MAX_AGE = 2 * D;
export const STORY_MAX_AGE = 26 * H;
export const STORY_EVERY = H;

export type ReelTier = "new" | "30m" | "1h" | "4h" | "1d" | "7d";
export type Tier = "story" | ReelTier;
export type AgeGroup = "young" | "old";

export const TIERS: readonly Tier[] = ["story", "new", "30m", "1h", "4h", "1d", "7d"];

interface TierRule {
  tier: Exclude<ReelTier, "new">;
  group: AgeGroup;
  /** Idade no intervalo [minAge, maxAge). */
  minAge: number;
  maxAge: number;
  /** Relê quando a última leitura tem mais que isso. */
  every: number;
}

export const REEL_TIERS: readonly TierRule[] = [
  { tier: "30m", group: "young", minAge: 0, maxAge: 2 * H, every: 30 * MIN },
  { tier: "1h", group: "young", minAge: 2 * H, maxAge: 6 * H, every: H },
  { tier: "4h", group: "young", minAge: 6 * H, maxAge: 2 * D, every: 4 * H },
  { tier: "1d", group: "old", minAge: 2 * D, maxAge: 14 * D, every: D },
  { tier: "7d", group: "old", minAge: 14 * D, maxAge: 60 * D, every: 7 * D },
];

/** Coluna que dá a idade do reel e, opcionalmente, a de reserva quando ela é nula. */
export interface DateSource {
  col: string;
  fallback?: string;
}

export const POSTAR_DATE: DateSource = { col: "published_at" };
export const LOOP_DATE: DateSource = { col: "published_at", fallback: "created_at" };

const iso = (msAgo: number, now: number) => new Date(now - msAgo).toISOString();
const and = (conds: string[]) => `and(${conds.join(",")})`;

/**
 * Filtro `or` (PostgREST) dos reels devidos de um grupo de idade. Mesmas
 * fronteiras de `classifyReel`: idade em [min, max) ⇔ data ≤ now−min e
 * data > now−max; devido ⇔ insights_fetched_at < now−intervalo.
 *
 * Com coluna de reserva (Loop), cada faixa vira dois ramos: um pela coluna
 * principal e outro pela reserva, só onde a principal é nula.
 */
export function reelEligibilityFilter(group: AgeGroup, dates: DateSource, now: number): string {
  const sources: Array<{ col: string; guard: string[] }> = [{ col: dates.col, guard: [] }];
  if (dates.fallback) sources.push({ col: dates.fallback, guard: [`${dates.col}.is.null`] });

  const branches: string[] = [];
  for (const { col, guard } of sources) {
    // Nunca lido: jovens a partir de 15 min; antigos sem limite de idade (lidos uma vez).
    branches.push(
      group === "young"
        ? and([...guard, "insights_fetched_at.is.null", `${col}.lte.${iso(FIRST_READ_MIN_AGE, now)}`, `${col}.gt.${iso(YOUNG_MAX_AGE, now)}`])
        : and([...guard, "insights_fetched_at.is.null", `${col}.lte.${iso(YOUNG_MAX_AGE, now)}`])
    );
    for (const t of REEL_TIERS) {
      if (t.group !== group) continue;
      branches.push(and([
        ...guard,
        `${col}.lte.${iso(t.minAge, now)}`,
        `${col}.gt.${iso(t.maxAge, now)}`,
        `insights_fetched_at.lt.${iso(t.every, now)}`,
      ]));
    }
  }
  return branches.join(",");
}

/** Data que conta a idade do reel: a coluna principal ou, se nula, a de reserva. */
export function reelAgeDate(row: Record<string, unknown>, dates: DateSource): string | null {
  const main = row[dates.col];
  if (typeof main === "string" && main) return main;
  const fb = dates.fallback ? row[dates.fallback] : null;
  return typeof fb === "string" && fb ? fb : null;
}

export interface Due {
  tier: Tier;
  /** Quanto já passou do momento da leitura (ms). Ordena dentro do grupo. */
  overdueMs: number;
}

const toMs = (v: string | null): number | null => {
  if (!v) return null;
  const ms = Date.parse(v);
  return Number.isNaN(ms) ? null : ms;
};

/** Faixa do reel se a leitura está devida agora; null se ainda não (ou nunca mais). */
export function classifyReel(dateIso: string | null, fetchedAt: string | null, now: number): Due | null {
  const date = toMs(dateIso);
  if (date === null) return null;
  const age = now - date;

  if (!fetchedAt) {
    return age >= FIRST_READ_MIN_AGE ? { tier: "new", overdueMs: age - FIRST_READ_MIN_AGE } : null;
  }
  const fetched = toMs(fetchedAt);
  if (fetched === null) return null;

  const rule = REEL_TIERS.find((t) => age >= t.minAge && age < t.maxAge);
  if (!rule) return null;
  const sinceRead = now - fetched;
  return sinceRead > rule.every ? { tier: rule.tier, overdueMs: sinceRead - rule.every } : null;
}

/** Story elegível (o banco já filtrou < 26h e leitura com 1h+). Nunca lido vem antes. */
export function classifyStory(fetchedAt: string | null, now: number): Due {
  const fetched = toMs(fetchedAt);
  return { tier: "story", overdueMs: fetched === null ? Number.MAX_SAFE_INTEGER : now - fetched - STORY_EVERY };
}

// Prioridade do lote: stories → nunca lidos → faixas jovens → faixas antigas.
const RANK: Record<Tier, number> = { story: 0, new: 1, "30m": 2, "1h": 2, "4h": 2, "1d": 3, "7d": 3 };

export interface Prioritized extends Due {
  /** Identidade da linha (tabela:id), para não ler o mesmo post duas vezes. */
  key: string;
}

export interface BatchPlan<T> {
  batch: T[];
  /** Candidatos que ficaram para o próximo run (candidatos − lote). */
  leftover: number;
  candidates: number;
  byTier: Record<Tier, number>;
}

/** Junta os candidatos de todas as consultas e corta o lote na capacidade. */
export function planBatch<T extends Prioritized>(items: T[], capacity: number): BatchPlan<T> {
  const seen = new Set<string>();
  const unique: T[] = [];
  for (const it of items) {
    if (seen.has(it.key)) continue;
    seen.add(it.key);
    unique.push(it);
  }

  const byTier = Object.fromEntries(TIERS.map((t) => [t, 0])) as Record<Tier, number>;
  for (const it of unique) byTier[it.tier]++;

  const ordered = [...unique].sort((a, b) => RANK[a.tier] - RANK[b.tier] || b.overdueMs - a.overdueMs);
  const batch = ordered.slice(0, Math.max(0, capacity));
  return { batch, leftover: unique.length - batch.length, candidates: unique.length, byTier };
}
