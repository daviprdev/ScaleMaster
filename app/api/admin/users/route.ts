import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getSupabaseAdmin } from "@/lib/supabase";

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: roleData } = await supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", user.id)
    .single();

  if (roleData?.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const admin = getSupabaseAdmin();

  const [
    { data: authData, error: authError },
    { data: roles },
    { data: accounts },
  ] = await Promise.all([
    admin.auth.admin.listUsers({ perPage: 1000 }),
    admin.from("user_roles").select("user_id, role, account_status, pending_message"),
    admin
      .from("instagram_accounts")
      .select("user_id, username, is_active, token_expires_at"),
  ]);

  if (authError) {
    return NextResponse.json({ error: authError.message }, { status: 500 });
  }

  type RoleRow = { user_id: string; role: string; account_status: string; pending_message: string | null };
  const rolesMap = new Map(
    (roles as unknown as RoleRow[] ?? []).map((r) => [
      r.user_id,
      { role: r.role, account_status: r.account_status ?? "pending", pending_message: r.pending_message ?? null },
    ])
  );

  const accountsMap = new Map<string, typeof accounts>();
  for (const acc of accounts ?? []) {
    if (!accountsMap.has(acc.user_id)) accountsMap.set(acc.user_id, []);
    accountsMap.get(acc.user_id)!.push(acc);
  }

  const users = (authData?.users ?? []).map((u) => {
    const rd = rolesMap.get(u.id);
    return {
      id: u.id,
      email: u.email ?? "—",
      created_at: u.created_at,
      role: rd?.role ?? "user",
      account_status: rd?.account_status ?? "pending",
      pending_message: rd?.pending_message ?? null,
      accounts: accountsMap.get(u.id) ?? [],
    };
  });

  // Sort: pending first, then by created_at desc
  users.sort((a, b) => {
    if (a.account_status === "pending" && b.account_status !== "pending") return -1;
    if (a.account_status !== "pending" && b.account_status === "pending") return 1;
    return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
  });

  return NextResponse.json({ users });
}
