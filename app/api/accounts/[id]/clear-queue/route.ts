import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getSupabaseAdmin } from "@/lib/supabase";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Remove posts pendentes/em publicação e containers travados na fila de UMA conta
// específica. Não afeta posts já publicados no Instagram — apenas limpa o histórico
// interno de agendamento (scheduled_posts + pending_containers) desta conta.
export async function POST(
  _: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: accountId } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  const admin = getSupabaseAdmin() as any;

  const { data: account } = await admin
    .from("instagram_accounts")
    .select("id")
    .eq("id", accountId)
    .eq("user_id", user.id)
    .single();

  if (!account) return NextResponse.json({ error: "Conta não encontrada." }, { status: 404 });

  const [postsRes, containersRes] = await Promise.all([
    admin
      .from("scheduled_posts")
      .delete({ count: "exact" })
      .eq("user_id", user.id)
      .eq("account_id", accountId)
      .in("status", ["pending", "publishing"]),

    admin
      .from("pending_containers")
      .delete({ count: "exact" })
      .eq("user_id", user.id)
      .eq("account_id", accountId)
      .in("status", ["pending", "publishing", "error"]),
  ]);

  if (postsRes.error) {
    return NextResponse.json({ error: postsRes.error.message }, { status: 500 });
  }
  if (containersRes.error) {
    return NextResponse.json({ error: containersRes.error.message }, { status: 500 });
  }

  return NextResponse.json({
    success: true,
    deleted: {
      scheduled_posts: postsRes.count ?? 0,
      pending_containers: containersRes.count ?? 0,
    },
  });
}
