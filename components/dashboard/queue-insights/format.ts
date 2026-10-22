/**
 * Formatação do Raio-X da fila. Números sempre por extenso em pt-BR
 * (2.080.527), igual ao print do Hotler — nada de "2,1 mi".
 */

const intFmt = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 });

/** 2080527 → "2.080.527"; sem valor → "—". */
export function fmtInt(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return intFmt.format(Math.round(n));
}

/** Plural simples: plural(3, "post", "posts") → "3 posts". */
export function plural(n: number, one: string, many: string): string {
  return `${fmtInt(n)} ${Math.round(n) === 1 ? one : many}`;
}

/** 868 → "868 views"; 1 → "1 view". */
export function fmtViews(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "— views";
  return plural(n, "view", "views");
}
