import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getSupabaseAdmin } from "@/lib/supabase";

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

  const [
    { data: authData },
    { count: totalAccounts },
    { count: totalScheduled },
    { count: totalPublished },
    { data: growthRaw },
    { data: rolesRaw },
  ] = await Promise.all([
    admin.auth.admin.listUsers({ perPage: 1000 }),
    admin.from("instagram_accounts").select("*", { count: "exact", head: true }),
    admin
      .from("scheduled_posts")
      .select("*", { count: "exact", head: true })
      .eq("status", "pending"),
    admin
      .from("scheduled_posts")
      .select("*", { count: "exact", head: true })
      .eq("status", "published"),
    admin.rpc("admin_user_growth_30d"),
    admin.from("user_roles").select("account_status"),
  ]);

  const usersByStatus = { pending: 0, approved: 0, banned: 0 };
  for (const r of (rolesRaw ?? []) as { account_status: string }[]) {
    const s = r.account_status as keyof typeof usersByStatus;
    if (s in usersByStatus) usersByStatus[s]++;
  }

  // Fallback: se a RPC não existir, agrega no Node com os dados do auth
  let userGrowth: { date: string; users: number }[] = [];

  if (growthRaw && Array.isArray(growthRaw)) {
    userGrowth = growthRaw as { date: string; users: number }[];
  } else {
    // Agrega a partir de authData
    const countByDay: Record<string, number> = {};
    const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
    for (const u of authData?.users ?? []) {
      const ts = new Date(u.created_at).getTime();
      if (ts < cutoff) continue;
      const day = u.created_at.slice(0, 10);
      countByDay[day] = (countByDay[day] ?? 0) + 1;
    }
    userGrowth = Object.entries(countByDay)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, users]) => ({ date, users }));
  }

  // Preenche dias sem cadastro com zero (para o gráfico ficar contínuo)
  const filledGrowth: { date: string; users: number }[] = [];
  for (let i = 29; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86_400_000);
    const key = d.toISOString().slice(0, 10);
    const found = userGrowth.find((g) => g.date === key);
    filledGrowth.push({ date: key, users: found?.users ?? 0 });
  }

  return NextResponse.json({
    totalUsers: authData?.users.length ?? 0,
    usersByStatus,
    totalAccounts: totalAccounts ?? 0,
    totalScheduled: totalScheduled ?? 0,
    totalPublished: totalPublished ?? 0,
    userGrowth: filledGrowth,
  });
}
