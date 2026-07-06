import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getSupabaseAdmin } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface PatchBody {
  status?: "active" | "paused";
  interval_minutes?: number;
  account_ids?: string[];
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });

  const admin = getSupabaseAdmin();
  const { data: template } = await admin
    .from("story_templates")
    .select("id")
    .eq("id", id)
    .eq("user_id", user.id)
    .single();
  if (!template) return NextResponse.json({ error: "Template não encontrado." }, { status: 404 });

  const body = await req.json().catch(() => ({})) as PatchBody;
  const update: Record<string, unknown> = {};
  if (body.status === "active" || body.status === "paused") update.status = body.status;
  if (body.interval_minutes && body.interval_minutes > 0) update.interval_minutes = body.interval_minutes;

  if (Object.keys(update).length > 0) {
    const { error } = await admin.from("story_templates").update(update).eq("id", id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (body.account_ids) {
    const { data: ownedAccounts } = await admin
      .from("instagram_accounts")
      .select("id")
      .eq("user_id", user.id)
      .in("id", body.account_ids);
    const validAccountIds = (ownedAccounts ?? []).map((a: { id: string }) => a.id);

    await admin.from("story_template_accounts").delete().eq("template_id", id);
    if (validAccountIds.length > 0) {
      const { error: linkErr } = await admin.from("story_template_accounts").insert(
        validAccountIds.map((accountId) => ({ template_id: id, account_id: accountId }))
      );
      if (linkErr) return NextResponse.json({ error: linkErr.message }, { status: 500 });
    }
  }

  return NextResponse.json({ success: true });
}

export async function DELETE(
  _: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });

  const admin = getSupabaseAdmin();
  const { error } = await admin
    .from("story_templates")
    .delete()
    .eq("id", id)
    .eq("user_id", user.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ success: true });
}
