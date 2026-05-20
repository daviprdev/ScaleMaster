import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { logAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ userId: string }> }
) {
  const { userId } = await params;

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

  if (userId === user.id) {
    return NextResponse.json(
      { error: "Não é possível alterar o próprio cargo" },
      { status: 400 }
    );
  }

  const body = await request.json();
  const admin = getSupabaseAdmin();

  // Fetch target user email for audit logs
  const { data: targetAuthData } = await admin.auth.admin.getUserById(userId);
  const targetEmail = targetAuthData?.user?.email;

  // Handle role change
  if (body.role !== undefined) {
    const role = body.role as string;
    if (!["user", "admin", "banned"].includes(role)) {
      return NextResponse.json({ error: "Role inválida" }, { status: 400 });
    }
    const { error } = await admin
      .from("user_roles")
      .upsert({ user_id: userId, role }, { onConflict: "user_id" });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (role === "banned") {
      await logAudit({ action: "user_banned", actorId: user.id, actorEmail: user.email, targetId: userId, targetEmail });
    }
    return NextResponse.json({ ok: true, role });
  }

  // Handle account_status change (approve / reject)
  if (body.account_status !== undefined) {
    const account_status = body.account_status as string;
    if (!["pending", "approved", "banned"].includes(account_status)) {
      return NextResponse.json({ error: "Status inválido" }, { status: 400 });
    }
    const { error } = await admin
      .from("user_roles")
      .upsert({ user_id: userId, account_status }, { onConflict: "user_id" });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (account_status === "approved") {
      await logAudit({ action: "user_approved", actorId: user.id, actorEmail: user.email, targetId: userId, targetEmail });
    } else if (account_status === "banned") {
      await logAudit({ action: "user_rejected", actorId: user.id, actorEmail: user.email, targetId: userId, targetEmail });
    }
    return NextResponse.json({ ok: true, account_status });
  }

  return NextResponse.json({ error: "Nenhum campo para atualizar" }, { status: 400 });
}
