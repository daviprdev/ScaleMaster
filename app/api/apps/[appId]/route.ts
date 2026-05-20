import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { encrypt } from "@/lib/encrypt";

export const dynamic = "force-dynamic";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ appId: string }> }
) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { appId } = await params;
  const body = await request.json();

  const updates: Record<string, string> = { updated_at: new Date().toISOString() };

  if (body.app_name !== undefined) {
    const name = String(body.app_name).trim().slice(0, 100);
    if (!name) return NextResponse.json({ error: "Nome não pode ser vazio." }, { status: 400 });
    updates.app_name = name;
  }
  if (body.ig_app_id !== undefined) {
    const id = String(body.ig_app_id).trim();
    if (!id) return NextResponse.json({ error: "App ID não pode ser vazio." }, { status: 400 });
    updates.ig_app_id = id;
  }
  if (body.ig_app_secret !== undefined && String(body.ig_app_secret).trim()) {
    try {
      updates.ig_app_secret = encrypt(String(body.ig_app_secret).trim());
    } catch {
      return NextResponse.json({ error: "Falha na criptografia. Configure ENCRYPTION_SECRET." }, { status: 500 });
    }
  }

  const admin = getSupabaseAdmin();
  const { data, error } = await admin
    .from("user_meta_apps")
    .update(updates)
    .eq("id", appId)
    .eq("user_id", user.id)
    .select("id, app_name, ig_app_id, created_at, updated_at")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "App não encontrado." }, { status: 404 });
  return NextResponse.json({ app: data });
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ appId: string }> }
) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { appId } = await params;
  const admin = getSupabaseAdmin();
  const { error } = await admin
    .from("user_meta_apps")
    .delete()
    .eq("id", appId)
    .eq("user_id", user.id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
