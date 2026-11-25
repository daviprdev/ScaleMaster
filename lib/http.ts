/**
 * lib/http.ts — fetch "cru" para o servidor, no lugar do `undici.fetch`.
 *
 * No Cloudflare Workers a undici não roda (precisa de sockets do Node). O fetch
 * global serve, mas o Next.js 15 o envolve com o cache dele, e isso já corrompeu
 * respostas binárias do CDN do Instagram. Aqui usamos o fetch original que o
 * Next guarda em `_nextOriginalFetch`, sempre com `cache: "no-store"`.
 *
 * `dispatcher` (proxy da undici) é aceito e descartado: no Workers toda chamada
 * sai direto. // decisão: sem proxies na publicação desde a migração.
 */

/** Tipo opaco no lugar do `Dispatcher` da undici. Nunca é usado de fato. */
export type Dispatcher = { close(): Promise<void> };

type FetchFn = typeof globalThis.fetch;

function originalFetch(): FetchFn {
  const patched = globalThis.fetch as FetchFn & { _nextOriginalFetch?: FetchFn };
  return patched._nextOriginalFetch ?? globalThis.fetch;
}

export type HttpInit = RequestInit & { dispatcher?: unknown };

export function httpFetch(input: string | URL | Request, init?: HttpInit): Promise<Response> {
  const { dispatcher: _ignored, ...rest } = init ?? {};
  return originalFetch()(input, { cache: "no-store", ...rest });
}
