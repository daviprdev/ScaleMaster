/**
 * Raio-X da fila — estatística básica (puro, também roda no navegador).
 */

/** Mediana; null para lista vazia. */
export function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** Média; null para lista vazia. */
export function mean(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  let sum = 0;
  for (const v of values) sum += v;
  return sum / values.length;
}

/**
 * Percentil por posição (nearest-rank): devolve um valor que existe na lista.
 * p em 0–1. "views ≥ p90" = está entre os 10% maiores.
 */
export function percentile(values: readonly number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.ceil(p * sorted.length);
  return sorted[Math.min(sorted.length - 1, Math.max(0, rank - 1))];
}

/** Arredonda para inteiro mantendo null. */
export function roundOrNull(value: number | null): number | null {
  return value == null ? null : Math.round(value);
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Inteiro dentro de [min, max]; NaN vira min. */
export function clampInt(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return clamp(Math.round(value), min, max);
}

/** a ÷ b, ou null quando algum lado falta ou b ≤ 0. */
export function ratio(a: number | null, b: number | null): number | null {
  if (a == null || b == null || b <= 0) return null;
  return a / b;
}

/** Agrupa preservando a ordem de chegada. */
export function groupBy<T>(items: readonly T[], keyOf: (item: T) => string | null): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const key = keyOf(item);
    if (key == null) continue;
    const list = groups.get(key);
    if (list) list.push(item);
    else groups.set(key, [item]);
  }
  return groups;
}
