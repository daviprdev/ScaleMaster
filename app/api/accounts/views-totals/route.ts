/**
 * GET /api/accounts/views-totals
 *
 * Total de views de cada conta do usuário (soma de account_views_daily, a
 * mesma tabela do card "Views Totais" da Dashboard). O cron
 * sync-account-views atualiza cada conta ~1×/hora; a aba Contas relê daqui.
 *
 * Resposta: { totals: { [account_id]: number } }
 */
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getSupabaseAdmin } from "@/lib/supabase";

export const dynamic = "force-dynamic";

const PAGE = 1000;
const MAX_PAGES = 50; // 50 mil linhas: ~400 contas × 120 dias

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });

  const admin = getSupabaseAdmin();
  const totals: Record<string, number> = {};

  for (let page = 0; page < MAX_PAGES; page++) {
    const { data, error } = await admin
      .from("account_views_daily")
      .select("account_id, views")
      .eq("user_id", user.id)
      .order("account_id", { ascending: true })
      .order("day", { ascending: true })
      .range(page * PAGE, page * PAGE + PAGE - 1);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    const rows = (data ?? []) as { account_id: string; views: number | null }[];
    for (const r of rows) totals[r.account_id] = (totals[r.account_id] ?? 0) + (Number(r.views) || 0);
    if (rows.length < PAGE) break;
  }

  return NextResponse.json({ totals }, { headers: { "Cache-Control": "no-store" } });
}
