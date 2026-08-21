/**
 * lib/meta-insights.ts — Busca métricas de um post publicado (likes, comments,
 * reach, views/plays, shares, saved) via Meta Graph API.
 *
 * Extraído de app/api/meta/insights/route.ts para reuso pelo cron de
 * sincronização em lote (app/api/cron/sync-post-insights/route.ts).
 */

import { fetch as undiciFetch } from "undici";
import { proxyInit } from "@/lib/proxy";
import type { ProxyAgent } from "undici";

const GRAPH_API = "https://graph.instagram.com/v21.0";

export interface PostInsights {
  likes: number | null;
  comments: number | null;
  reach: number | null;
  plays: number | null;
  shares: number | null;
  saved: number | null;
}

async function fetchBasicMetrics(
  mediaId: string,
  token: string,
  proxy: ProxyAgent | null
): Promise<{ likes: number | null; comments: number | null }> {
  const res = await undiciFetch(
    `${GRAPH_API}/${mediaId}?fields=like_count,comments_count&access_token=${encodeURIComponent(token)}`,
    { ...proxyInit(proxy), signal: AbortSignal.timeout(15_000) } as any
  );
  const data = (await res.json()) as {
    like_count?: number;
    comments_count?: number;
    error?: { message: string };
  };
  if (!res.ok) return { likes: null, comments: null };
  return {
    likes: data.like_count ?? null,
    comments: data.comments_count ?? null,
  };
}

async function fetchInsightsMetrics(
  mediaId: string,
  token: string,
  proxy: ProxyAgent | null
): Promise<{ reach: number | null; plays: number | null; shares: number | null; saved: number | null }> {
  const metrics = ["reach", "views", "shares", "saved"].join(",");
  const res = await undiciFetch(
    `${GRAPH_API}/${mediaId}/insights?metric=${metrics}&period=lifetime&access_token=${encodeURIComponent(token)}`,
    { ...proxyInit(proxy), signal: AbortSignal.timeout(15_000) } as any
  );
  const data = (await res.json()) as {
    data?: Array<{ name: string; values: Array<{ value: number }> }>;
    error?: { message: string; code?: number };
  };

  if (!res.ok || data.error) {
    console.warn(
      `[meta-insights] insights falhou p/ media ${mediaId} | http=${res.status} | ` +
      `error=${JSON.stringify(data.error ?? data)}`
    );
    return { reach: null, plays: null, shares: null, saved: null };
  }

  const get = (name: string): number | null =>
    data.data?.find((m) => m.name === name)?.values?.[0]?.value ?? null;

  return {
    reach: get("reach"),
    plays: get("views"),
    shares: get("shares"),
    saved: get("saved"),
  };
}

export async function fetchPostInsights(
  mediaId: string,
  token: string,
  proxy: ProxyAgent | null
): Promise<PostInsights> {
  const [basic, advanced] = await Promise.all([
    fetchBasicMetrics(mediaId, token, proxy),
    fetchInsightsMetrics(mediaId, token, proxy),
  ]);

  return {
    likes: basic.likes,
    comments: basic.comments,
    reach: advanced.reach,
    plays: advanced.plays,
    shares: advanced.shares,
    saved: advanced.saved,
  };
}
