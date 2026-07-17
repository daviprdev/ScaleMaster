import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { claimProxyForAccount } from "@/lib/proxy-pool";

export const runtime = "nodejs";

// POST /api/proxy-pool/assign — atribui proxies do estoque a TODAS as contas
// do usuário que estão sem proxy (sequencial: claim atômico por conta).
export async function POST() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });

  const admin = getSupabaseAdmin();
  const { data: accounts } = await admin
    .from("instagram_accounts")
    .select("id, username")
    .eq("user_id", user.id)
    .is("proxy_url", null)
    .order("connected_at", { ascending: true });

  const pending = (accounts ?? []) as Array<{ id: string; username: string }>;
  if (pending.length === 0) {
    return NextResponse.json({ assigned: 0, out_of_stock: 0, message: "Todas as contas já têm proxy." });
  }

  let assigned = 0;
  const assignedUsernames: string[] = [];
  for (const acc of pending) {
    const result = await claimProxyForAccount(admin, user.id, acc.id);
    if (!result.assigned) break; // estoque esgotou — as demais ficam sem
    assigned++;
    assignedUsernames.push(acc.username);
  }

  return NextResponse.json({
    assigned,
    out_of_stock: pending.length - assigned,
    assigned_usernames: assignedUsernames,
  });
}
