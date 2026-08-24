import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { swapProxyForAccount } from "@/lib/proxy-pool";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface FailingAccount {
  id: string;
  username: string;
  proxy_url: string | null;
}

// POST /api/proxy-pool/swap-failed — descarta o proxy das contas com falha
// recente e reivindica substitutos do estoque (mesmo botão do ProxyOutageBanner).
// Body opcional: { minutes?: number } — janela de falha considerada (padrão 30).
export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });

  let minutes = 30;
  try {
    const body = await req.json();
    if (typeof body?.minutes === "number" && body.minutes > 0) minutes = body.minutes;
  } catch { /* body opcional */ }

  const admin = getSupabaseAdmin();
  const since = new Date(Date.now() - minutes * 60 * 1000).toISOString();

  const { data: accounts, error } = await admin
    .from("instagram_accounts")
    .select("id, username, proxy_url")
    .eq("user_id", user.id)
    .eq("is_active", true)
    .not("proxy_url", "is", null)
    .gte("last_proxy_error_at", since);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const candidates = (accounts ?? []) as FailingAccount[];
  if (candidates.length === 0) {
    return NextResponse.json({
      candidates: 0,
      swapped: 0,
      no_stock: 0,
      swapped_usernames: [],
      no_stock_usernames: [],
      message: "Nenhuma conta com falha de proxy na janela verificada.",
    });
  }

  const swappedUsernames: string[] = [];
  const noStockUsernames: string[] = [];

  for (const acc of candidates) {
    const result = await swapProxyForAccount(admin, user.id, acc.id, acc.proxy_url);
    if (result.swapped) swappedUsernames.push(acc.username);
    else noStockUsernames.push(acc.username);
  }

  return NextResponse.json({
    candidates: candidates.length,
    swapped: swappedUsernames.length,
    no_stock: noStockUsernames.length,
    swapped_usernames: swappedUsernames,
    no_stock_usernames: noStockUsernames,
  });
}
