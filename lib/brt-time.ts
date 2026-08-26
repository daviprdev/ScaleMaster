// Brasil não tem horário de verão desde 2019 — offset fixo.
const BRT_OFFSET_MS = 3 * 60 * 60 * 1000;

/** Meia-noite (BRT) de N dias atrás, convertida para um Date em UTC. */
export function brtMidnightUtc(daysAgo: number): Date {
  const nowBrt = new Date(Date.now() - BRT_OFFSET_MS);
  const y = nowBrt.getUTCFullYear();
  const m = nowBrt.getUTCMonth();
  const d = nowBrt.getUTCDate();
  return new Date(Date.UTC(y, m, d - daysAgo, 0, 0, 0) + BRT_OFFSET_MS);
}

/** Meia-noite (BRT) do dia 1º do mês, N meses atrás, convertida para um Date em UTC. */
export function brtMonthStartUtc(monthsAgo = 0): Date {
  const nowBrt = new Date(Date.now() - BRT_OFFSET_MS);
  const y = nowBrt.getUTCFullYear();
  const m = nowBrt.getUTCMonth();
  return new Date(Date.UTC(y, m - monthsAgo, 1, 0, 0, 0) + BRT_OFFSET_MS);
}
