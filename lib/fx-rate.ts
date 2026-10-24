/**
 * lib/fx-rate.ts — Cotação em reais de moeda estrangeira.
 *
 * A dashboard soma `sales.amount` como BRL, então a venda dos bots da gringa
 * (dólar, euro…) é gravada já convertida, na cotação da hora da venda.
 * AwesomeAPI é o comercial ao vivo; a open.er-api (diária) cobre quando ela
 * cai. A cotação fica guardada 15 min por moeda.
 */

// Sem imports `@/`: lib/sharkbot.ts usa este módulo e roda na suíte de testes,
// fora do resolver de paths do Next.

const CACHE_TTL_MS = 15 * 60_000;
const FETCH_TIMEOUT_MS = 5_000;

// globalThis: cada rota do Next tem seu bundle, e a cotação guardada é uma só
// no processo.
const store = globalThis as unknown as {
  __fxRates?: Map<string, { rate: number; at: number }>;
};

async function getJson(url: string): Promise<unknown> {
  const res = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

const SOURCES: { name: string; rate: (code: string) => Promise<unknown> }[] = [
  {
    name: "awesomeapi",
    rate: async (code) => {
      const data = (await getJson(`https://economia.awesomeapi.com.br/json/last/${code}-BRL`)) as
        | Record<string, { bid?: string }>
        | null;
      return data?.[`${code}BRL`]?.bid;
    },
  },
  {
    name: "open.er-api",
    rate: async (code) => {
      const data = (await getJson(`https://open.er-api.com/v6/latest/${code}`)) as { rates?: { BRL?: number } } | null;
      return data?.rates?.BRL;
    },
  },
];

/** Quantos reais vale 1 unidade de `currency` (código ISO, ex.: "USD"), ou null sem cotação. */
export async function rateToBrl(currency: string): Promise<number | null> {
  const code = currency.trim().toUpperCase();
  if (code === "BRL") return 1;
  if (!/^[A-Z]{3}$/.test(code)) return null;

  const cache = (store.__fxRates ??= new Map());
  const cached = cache.get(code);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.rate;

  for (const source of SOURCES) {
    try {
      const rate = Number(await source.rate(code));
      if (Number.isFinite(rate) && rate > 0) {
        cache.set(code, { rate, at: Date.now() });
        return rate;
      }
      console.warn(`[fx-rate] ${source.name} sem cotação ${code}-BRL.`);
    } catch (e) {
      console.warn(`[fx-rate] ${source.name} falhou (${code}-BRL):`, e instanceof Error ? e.message : String(e));
    }
  }
  // As duas fontes fora do ar: cotação antiga ainda é melhor que venda sem valor.
  return cached?.rate ?? null;
}
