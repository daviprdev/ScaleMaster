import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
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

    const { data: updated, error: updateErr } = await admin
      .from("user_roles")
      .update({ role } as never)
      .eq("user_id", userId)
      .select("user_id");

    if (updateErr) return NextResponse.json({ error: updateErr.message }, { status: 500 });

    // Row não existe ainda — cria
    if (!updated || updated.length === 0) {
      const { error: insertErr } = await admin
        .from("user_roles")
        .insert({ user_id: userId, role } as never);
      if (insertErr) return NextResponse.json({ error: insertErr.message }, { status: 500 });
    }

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

    const { data: updated, error: updateErr } = await admin
      .from("user_roles")
      .update({ account_status } as never)
      .eq("user_id", userId)
      .select("user_id");

    if (updateErr) return NextResponse.json({ error: updateErr.message }, { status: 500 });

    // Row não existe ainda — cria com role padrão
    if (!updated || updated.length === 0) {
      const { error: insertErr } = await admin
        .from("user_roles")
        .insert({ user_id: userId, role: "user", account_status } as never);
      if (insertErr) return NextResponse.json({ error: insertErr.message }, { status: 500 });
    }

    if (account_status === "approved") {
      await logAudit({ action: "user_approved", actorId: user.id, actorEmail: user.email, targetId: userId, targetEmail });
    } else if (account_status === "banned") {
      await logAudit({ action: "user_rejected", actorId: user.id, actorEmail: user.email, targetId: userId, targetEmail });
    } else if (account_status === "pending") {
      await logAudit({ action: "access_revoked", actorId: user.id, actorEmail: user.email, targetId: userId, targetEmail });
    }

    revalidatePath("/admin/users");
    return NextResponse.json({ ok: true, account_status });
  }

  return NextResponse.json({ error: "Nenhum campo para atualizar" }, { status: 400 });
}
