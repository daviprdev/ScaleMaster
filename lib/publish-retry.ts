/**
 * lib/publish-retry.ts — Mensagem e reagendamento de falha transitória no
 * publish-scheduled.
 *
 * Erro de rede do undici chega como "fetch failed" e a causa real (conexão
 * recusada, 407 da proxy, timeout) fica em `err.cause`. Sem ela, o post só
 * mostrava "[RETRY] fetch failed" e não dava para saber que a proxy estava morta.
 *
 * Todo retry transitório agora empurra scheduled_at. Antes, erro de rede/proxy
 * mantinha o horário original: um bloco de posts com proxy morta continuava
 * sendo o mais antigo da fila (ordenada por scheduled_at), voltava no lote de
 * 20 a cada minuto, falhava de novo e nenhum post atrás dele era tentado.
 */

const RATE_LIMIT_RE = /too many actions|retry your request later|please retry/i;
const PROXY_FAILURE_RE = /fetch failed|proxy|timeout|ECONN|ETIMEDOUT|ENOTFOUND|UND_ERR|\(407\)/i;

/** Falha de conexão de um post que sai pela proxy do estoque do usuário ("Usar minhas proxies"). */
export function isUserProxyFailure(msg: string | null | undefined, useProxyPool: boolean | null | undefined): boolean {
  return useProxyPool === true && !!msg && PROXY_FAILURE_RE.test(msg);
}

/** Mensagem do erro com a causa de rede encadeada (undici: err.cause.code/message). */
export function describePublishError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  const cause = (err as { cause?: unknown } | null)?.cause;
  if (!cause || typeof cause !== "object") return msg;
  const c = cause as { code?: unknown; message?: unknown };
  const parts = [typeof c.code === "string" ? c.code : "", typeof c.message === "string" ? c.message : ""]
    .filter(Boolean)
    .filter((p, i, arr) => arr.indexOf(p) === i);
  if (!parts.length) return msg;
  const detail = parts.join(": ");
  return msg.includes(detail) ? msg : `${msg} (${detail})`;
}

/**
 * Próximo horário de um post que falhou de forma transitória.
 * Rate-limit da Meta: +2 min com jitter 0–60 s (como antes).
 * Rede/proxy/timeout: +1 min com jitter 0–60 s — curto o bastante para um
 * blip de rede, e tira o post da frente da fila para os demais vencidos andarem.
 */
export function transientRetryAt(msg: string, nowMs: number, random: () => number = Math.random): string {
  const base = RATE_LIMIT_RE.test(msg) ? 120_000 : 60_000;
  return new Date(nowMs + base + Math.floor(random() * 60_000)).toISOString();
}
