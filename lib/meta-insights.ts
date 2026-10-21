/**
 * lib/meta-insights.ts — Busca métricas de um post publicado (likes, comments,
 * reach, views/plays, shares, saved) via Meta Graph API.
 *
 * Ponto único usado pelo cron de sincronização em lote
 * (app/api/cron/sync-post-insights), pela rota manual (app/api/meta/insights)
 * e pelo analytics de Loop (app/api/loops/[id]/analytics).
 *
 * Regra: métrica que a Meta não devolveu vem como `null` — NUNCA como 0. Quem
 * grava no banco usa `insightsUpdatePayload`, que omite os nulos, para que uma
 * falha transitória não apague views reais já obtidas.
 */

// Insights é endpoint oficial da Meta: conexão direta, sem proxy.
import { fetch as undiciFetch } from "undici";

const GRAPH_API = "https://graph.instagram.com/v21.0";

export interface PostInsights {
  likes: number | null;
  comments: number | null;
  reach: number | null;
  plays: number | null;
  shares: number | null;
  saved: number | null;
  /** true quando a Meta respondeu com limite de uso — o chamador deve parar a conta neste run. */
  rateLimited?: boolean;
  /** Mensagem da Meta quando o endpoint de insights falhou (diagnóstico). */
  error?: string | null;
}

export type InsightsMediaKind = "reel" | "story";

// Métricas válidas por tipo de mídia. Story não tem `saved`/`likes`/`comments`
// — pedir uma métrica inexistente faz a Meta recusar a chamada INTEIRA, e era
// por isso que stories sempre voltavam sem views.
const METRICS: Record<InsightsMediaKind, string> = {
  reel: "views,reach,likes,comments,shares,saved",
  story: "views,reach,shares",
};

// Códigos de limite de uso da Graph API (app/usuário/página/recurso) e 80002,
// o freio por conta do Instagram (muitas chamadas para a mesma conta).
const RATE_LIMIT_CODES = new Set([4, 17, 32, 613, 80002]);

interface GraphError { message?: string; code?: number }

async function getJson(url: string): Promise<{ ok: boolean; status: number; data: Record<string, unknown> }> {
  const res = await undiciFetch(url, { signal: AbortSignal.timeout(15_000) });
  let data: Record<string, unknown> = {};
  try { data = (await res.json()) as Record<string, unknown>; } catch { /* corpo não-JSON */ }
  return { ok: res.ok && !data.error, status: res.status, data };
}

export async function fetchPostInsights(
  mediaId: string,
  token: string,
  kind: InsightsMediaKind = "reel"
): Promise<PostInsights> {
  const out: PostInsights = {
    likes: null, comments: null, reach: null, plays: null, shares: null, saved: null,
    rateLimited: false, error: null,
  };

  const ins = await getJson(
    `${GRAPH_API}/${mediaId}/insights?metric=${METRICS[kind]}&period=lifetime&access_token=${encodeURIComponent(token)}`
  );

  if (ins.ok) {
    const rows = (ins.data.data ?? []) as Array<{ name: string; values?: Array<{ value: number }>; total_value?: { value: number } }>;
    const get = (name: string): number | null => {
      const m = rows.find((r) => r.name === name);
      const v = m?.values?.[0]?.value ?? m?.total_value?.value;
      return typeof v === "number" ? v : null;
    };
    out.plays = get("views");
    out.reach = get("reach");
    out.shares = get("shares");
    if (kind === "reel") {
      out.likes = get("likes");
      out.comments = get("comments");
      out.saved = get("saved");
    }
  } else {
    const err = (ins.data.error ?? {}) as GraphError;
    out.error = err.message ?? `HTTP ${ins.status}`;
    out.rateLimited = typeof err.code === "number" && RATE_LIMIT_CODES.has(err.code);
    console.warn(
      `[meta-insights] insights falhou p/ media ${mediaId} (${kind}) | http=${ins.status} | ` +
      `code=${err.code ?? "-"} | ${out.error}`
    );
  }

  // likes/comments via campos básicos quando o endpoint de insights não trouxe
  // (ex.: falha de permissão só em insights). Não tenta de novo em rate limit.
  if (kind === "reel" && !out.rateLimited && (out.likes === null || out.comments === null)) {
    try {
      const basic = await getJson(
        `${GRAPH_API}/${mediaId}?fields=like_count,comments_count&access_token=${encodeURIComponent(token)}`
      );
      if (basic.ok) {
        if (out.likes === null && typeof basic.data.like_count === "number") out.likes = basic.data.like_count;
        if (out.comments === null && typeof basic.data.comments_count === "number") out.comments = basic.data.comments_count;
      }
    } catch { /* não crítico */ }
  }

  return out;
}

/**
 * Payload de UPDATE que só inclui métricas efetivamente obtidas. Uma falha
 * transitória (ou um story já expirado) nunca sobrescreve um valor real com
 * null/0. `insights_fetched_at` sempre avança para a fila não martelar o mesmo
 * post a cada run.
 */
export function insightsUpdatePayload(m: PostInsights): Record<string, unknown> {
  const payload: Record<string, unknown> = { insights_fetched_at: new Date().toISOString() };
  const map: Array<[keyof PostInsights, string]> = [
    ["likes", "insights_likes"],
    ["comments", "insights_comments"],
    ["reach", "insights_reach"],
    ["plays", "insights_plays"],
    ["shares", "insights_shares"],
    ["saved", "insights_saved"],
  ];
  for (const [k, col] of map) {
    const v = m[k];
    if (typeof v === "number") payload[col] = v;
  }
  return payload;
}
