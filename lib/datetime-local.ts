/**
 * Valor "YYYY-MM-DDTHH:mm" para <input type="datetime-local">, no fuso local do navegador.
 * Não usar toISOString().slice(0, 16): ele dá a hora UTC, que o input lê como local (3h adiantado em BRT).
 * Só chamar no cliente (useEffect/handlers): no SSR o container roda em UTC.
 */
export function toDatetimeLocalValue(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
