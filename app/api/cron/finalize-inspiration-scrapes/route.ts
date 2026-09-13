/**
 * /api/cron/finalize-inspiration-scrapes
 *
 * Termina as buscas de Inspirações que a página deixou para trás (usuário saiu,
 * fechou a aba, ou a página desistiu de esperar um perfil grande). Usa o mesmo
 * advanceSearch do polling da página — o claim atômico impede avanço duplo.
 */

import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { requireCronAuth } from "@/lib/cron-auth";
import { advanceSearch } from "@/lib/inspiration-scrape";

export const runtime = "nodejs";
export const maxDuration = 120;

const RUN_BUDGET_MS = 100_000;

export async function GET(request: NextRequest) {
  const cronAuth = requireCronAuth(request);
  if (!cronAuth.ok) return cronAuth.response;

  const admin = getSupabaseAdmin();
  const { data, error } = await (admin as any)
    .from("inspiration_scrape_searches")
    .select("id, username")
    .eq("status", "running")
    .order("updated_at", { ascending: true })
    .limit(20);

  if (error) {
    console.error("[cron/finalize-inspiration-scrapes]", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const startedAt = Date.now();
  const summary = { checked: 0, done: 0, running: 0, error: 0 };

  for (const s of (data ?? []) as { id: string; username: string }[]) {
    if (Date.now() - startedAt > RUN_BUDGET_MS) break;
    summary.checked++;
    const result = await advanceSearch(admin, s.id);
    summary[result.status]++;
    if (result.status === "done") {
      console.log(`[cron/finalize-inspiration-scrapes] @${s.username}: ${result.reels.length} reels salvos`);
    }
  }

  return NextResponse.json(summary);
}
