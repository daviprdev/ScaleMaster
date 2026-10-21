/**
 * Raio-X da fila — hora e dia em BRT (offset fixo −3h, como lib/brt-time.ts).
 *
 * Puro: nada de Date.now() — o instante sempre vem de fora (now / nowIso).
 */

import { brtDateKey } from "../brt-time";
import { HOUR_MS, MINUTE_MS } from "./constants";

const BRT_OFFSET_MS = 3 * HOUR_MS;

export function toMs(at: string | number | Date): number {
  return new Date(at).getTime();
}

/** YYYY-MM-DD do dia BRT do instante. */
export function brtDay(at: string | number | Date): string {
  return brtDateKey(at);
}

/** Hora BRT 0–23 do instante. */
export function brtHour(at: string | number | Date): number {
  return new Date(toMs(at) - BRT_OFFSET_MS).getUTCHours();
}

/** Dia BRT deslocado em `delta` dias (YYYY-MM-DD). */
export function shiftDay(day: string, delta: number): string {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + delta)).toISOString().slice(0, 10);
}

/** Instante (ms UTC) de `hour`:00 BRT do dia informado. */
export function brtHourStartMs(day: string, hour: number): number {
  const [y, m, d] = day.split("-").map(Number);
  return Date.UTC(y, m - 1, d, hour, 0, 0) + BRT_OFFSET_MS;
}

/** Arredonda para cima no próximo múltiplo de `minutes` (segundos zerados). */
export function ceilToMinutes(ms: number, minutes: number): number {
  const step = minutes * MINUTE_MS;
  return Math.ceil(ms / step) * step;
}

/** Próxima `hour`:00 BRT que seja ≥ `notBeforeMs`. */
export function nextBrtHourAtOrAfter(hour: number, notBeforeMs: number): number {
  const sameDay = brtHourStartMs(brtDay(notBeforeMs), hour);
  return sameDay >= notBeforeMs ? sameDay : brtHourStartMs(brtDay(notBeforeMs + 24 * HOUR_MS), hour);
}
