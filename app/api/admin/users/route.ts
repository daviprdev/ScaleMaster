import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getSupabaseAdmin } from "@/lib/supabase";

export async function GET() {
  // 1. Verifica sessão e role do requisitante
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

  // 2. Busca dados com service_role (sem RLS)
  const admin = getSupabaseAdmin();

  const [
    { data: authData, error: authError },
    { data: roles },
    { data: accounts },
  ] = await Promise.all([
    admin.auth.admin.listUsers({ perPage: 1000 }),
    admin.from("user_roles").select("user_id, role"),
    admin
      .from("instagram_accounts")
      .select("user_id, username, is_active, token_expires_at"),
  ]);

  if (authError) {
    return NextResponse.json({ error: authError.message }, { status: 500 });
  }

  // 3. Cruza os dados
  const rolesMap = new Map(roles?.map((r) => [r.user_id, r.role]) ?? []);

  const accountsMap = new Map<string, typeof accounts>();
  for (const acc of accounts ?? []) {
    if (!accountsMap.has(acc.user_id)) accountsMap.set(acc.user_id, []);
    accountsMap.get(acc.user_id)!.push(acc);
  }

  const users = (authData?.users ?? []).map((u) => ({
    id: u.id,
    email: u.email ?? "—",
    created_at: u.created_at,
    role: rolesMap.get(u.id) ?? "user",
    accounts: accountsMap.get(u.id) ?? [],
  }));

  return NextResponse.json({ users });
}
