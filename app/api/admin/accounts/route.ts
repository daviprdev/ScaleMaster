import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getSupabaseAdmin } from "@/lib/supabase";

export const dynamic = "force-dynamic";

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: roleData } = await supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", user.id)
    .single();

  if (roleData?.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const admin = getSupabaseAdmin();

  const [{ data: authData }, { data: accounts }] = await Promise.all([
    admin.auth.admin.listUsers({ perPage: 1000 }),
    admin
      .from("instagram_accounts")
      .select("id, user_id, username, display_name, is_active, connected_at, token_expires_at")
      .order("connected_at", { ascending: false }),
  ]);

  // Group accounts by user_id
  const accountsByUser = new Map<string, typeof accounts>();
  for (const acc of accounts ?? []) {
    if (!accountsByUser.has(acc.user_id)) accountsByUser.set(acc.user_id, []);
    accountsByUser.get(acc.user_id)!.push(acc);
  }

  // Return only users that have at least one account, sorted by count desc
  const users = (authData?.users ?? [])
    .filter((u) => accountsByUser.has(u.id))
    .map((u) => ({
      id: u.id,
      email: u.email ?? "—",
      created_at: u.created_at,
      accounts: accountsByUser.get(u.id) ?? [],
    }))
    .sort((a, b) => b.accounts.length - a.accounts.length);

  return NextResponse.json({ users });
}
