import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getSupabaseAdmin } from "@/lib/supabase";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// POST — remove todas as contas com health_status='error' de todos os loops do usuário
export async function POST() {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
    return NextResponse.json({ error: "Supabase não configurado" }, { status: 503 });
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  const admin = getSupabaseAdmin() as any;

  // Busca IDs de todas as contas em erro do usuário
  const { data: errorAccounts, error: accErr } = await admin
    .from("instagram_accounts")
    .select("id, username")
    .eq("user_id", user.id)
    .eq("health_status", "error");

  if (accErr) {
    return NextResponse.json({ error: accErr.message }, { status: 500 });
  }

  const accounts = (errorAccounts ?? []) as { id: string; username: string }[];
  if (accounts.length === 0) {
    return NextResponse.json({ removed: 0, usernames: [] });
  }

  const ids = accounts.map(a => a.id);

  const { error: delErr } = await admin
    .from("loop_accounts")
    .delete()
    .in("account_id", ids);

  if (delErr) {
    return NextResponse.json({ error: delErr.message }, { status: 500 });
  }

  return NextResponse.json({
    removed: accounts.length,
    usernames: accounts.map(a => a.username),
  });
}
