import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

/**
 * POST /api/inspirations/scrape/recover
 *
 * Rota desativada: a recuperação de buscas órfãs era específica da Apify
 * (lia datasets de runs antigos). Com a migração para ScrapeCreators, não
 * há mais runs/datasets externos para recuperar.
 *
 * Mantida como stub para não quebrar chamadas do admin panel — retorna
 * mensagem informativa em vez de 404.
 */
export async function POST(_req: NextRequest) {
  return NextResponse.json({
    imported: [],
    skipped: [],
    message:
      "A recuperação de buscas órfãs foi descontinuada após a migração para ScrapeCreators. " +
      "Buscas antigas da Apify já foram processadas ou expiraram.",
  });
}