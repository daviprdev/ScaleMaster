import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getSupabaseAdmin } from "@/lib/supabase";

export const dynamic = "force-dynamic";

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

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

  const emailMap = new Map(
    (authData?.users ?? []).map((u) => [u.id, u.email ?? "—"])
  );

  const result = (accounts ?? []).map((acc) => ({
    ...acc,
    user_email: emailMap.get(acc.user_id) ?? "—",
  }));

  return NextResponse.json({ accounts: result });
}
