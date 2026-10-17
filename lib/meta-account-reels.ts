/**
 * lib/meta-account-reels.ts — Reels publicados por uma conta, por dia de
 * Brasília, lidos da lista de mídias da própria conta na Meta.
 *
 * GET /{ig-user-id}/media?fields=timestamp,media_product_type&limit=100
 * (paginado, mais recente primeiro). Só media_product_type = "REELS" conta.
 *
 * Por que da Meta e não de scheduled_posts: os registros do SaaS somem quando
 * uma campanha é excluída com "apagar posts", e não incluem reels postados
 * por fora. Endpoint oficial da Meta: conexão direta, sem proxy.
 */

import { fetch as undiciFetch } from "undici";
import { GRAPH_API, RATE_LIMIT_CODES, MetaRateLimitError } from "@/lib/meta-account-views";

// Brasil não tem horário de verão desde 2019 — offset fixo.
const BRT_OFFSET_MS = 3 * 60 * 60 * 1000;
// Teto de segurança do backfill: 30 páginas × 100 = 3000 mídias por conta.
const MAX_PAGES = 30;

/** Dia de Brasília (YYYY-MM-DD) de um instante em ms. */
export function brtDay(ms: number): string {
  return new Date(ms - BRT_OFFSET_MS).toISOString().slice(0, 10);
}

export interface ReelsByDayResult {
  /** Reels por dia BRT. Com `sinceDay`, só dias >= sinceDay. */
  days: Map<string, number>;
  /** false se parou no teto de páginas antes de cobrir o período pedido. */
  complete: boolean;
}

/**
 * Conta os reels da conta por dia BRT. `sinceDay` (YYYY-MM-DD) para a
 * paginação assim que passa desse dia; null = histórico inteiro (backfill).
 */
export async function fetchReelsByDay(
  igUserId: string,
  token: string,
  sinceDay: string | null
): Promise<ReelsByDayResult> {
  const days = new Map<string, number>();
  let url: string | null =
    `${GRAPH_API}/${igUserId}/media?fields=timestamp,media_product_type&limit=100` +
    `&access_token=${encodeURIComponent(token)}`;

  for (let page = 0; url && page < MAX_PAGES; page++) {
    const res = await undiciFetch(url, { signal: AbortSignal.timeout(15_000) });
    let data: {
      data?: Array<{ timestamp?: string; media_product_type?: string }>;
      paging?: { next?: string };
      error?: { code?: number; message?: string };
    } = {};
    try { data = (await res.json()) as typeof data; } catch { /* corpo não-JSON */ }

    if (!res.ok || data.error) {
      const code = data.error?.code;
      const msg = data.error?.message ?? `HTTP ${res.status}`;
      if (typeof code === "number" && RATE_LIMIT_CODES.has(code)) throw new MetaRateLimitError(msg);
      throw new Error(`code=${code ?? "-"} ${msg}`);
    }

    let passedSince = false;
    for (const media of data.data ?? []) {
      const ms = Date.parse(media.timestamp ?? "");
      if (!Number.isFinite(ms)) continue;
      const day = brtDay(ms);
      if (sinceDay && day < sinceDay) { passedSince = true; continue; }
      if (media.media_product_type === "REELS") days.set(day, (days.get(day) ?? 0) + 1);
    }
    if (passedSince) return { days, complete: true };
    url = data.paging?.next ?? null;
  }

  return { days, complete: url === null };
}
