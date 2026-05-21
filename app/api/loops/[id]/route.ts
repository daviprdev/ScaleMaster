import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getSupabaseAdmin } from "@/lib/supabase";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) return NextResponse.json({ success: true });

  const { id } = await params;
  const body = await req.json() as Record<string, unknown>;

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  const anyAdmin = getSupabaseAdmin() as any;

  const updatePayload: Record<string, unknown> = {};
  const scalars = ["status", "name", "folder_id", "is_infinite", "cycles",
    "interval_minutes", "media_limit", "captions", "cover_image_url", "effect_mirror", "effect_invert"];
  for (const key of scalars) {
    if (key in body) updatePayload[key] = body[key];
  }

  if (Object.keys(updatePayload).length > 0) {
    const { error } = await anyAdmin
      .from("loops")
      .update(updatePayload)
      .eq("id", id)
      .eq("user_id", user.id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if ("account_ids" in body) {
    const accountIds = body.account_ids as string[];
    await anyAdmin.from("loop_accounts").delete().eq("loop_id", id);
    if (accountIds.length > 0) {
      const { error } = await anyAdmin
        .from("loop_accounts")
        .insert(accountIds.map((accId: string) => ({ loop_id: id, account_id: accId })));
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    }
  }

  return NextResponse.json({ success: true });
}

export async function DELETE(
  _: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) return NextResponse.json({ success: true });

  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  const { error } = await (getSupabaseAdmin() as any)
    .from("loops")
    .delete()
    .eq("id", id)
    .eq("user_id", user.id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
