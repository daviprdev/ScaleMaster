import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { encrypt } from "@/lib/encrypt";

export const dynamic = "force-dynamic";

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const admin = getSupabaseAdmin();
  const { data, error } = await admin
    .from("user_meta_apps")
    .select("id, app_name, ig_app_id, created_at, updated_at")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ apps: data ?? [] });
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json();
  const app_name = String(body.app_name ?? "").trim().slice(0, 100);
  const ig_app_id = String(body.ig_app_id ?? "").trim();
  const ig_app_secret = String(body.ig_app_secret ?? "").trim();

  if (!app_name || !ig_app_id || !ig_app_secret) {
    return NextResponse.json({ error: "Nome, App ID e App Secret são obrigatórios." }, { status: 400 });
  }

  let encryptedSecret: string;
  try {
    encryptedSecret = encrypt(ig_app_secret);
  } catch {
    return NextResponse.json({ error: "Falha na criptografia. Configure ENCRYPTION_SECRET." }, { status: 500 });
  }

  const admin = getSupabaseAdmin();
  const { data, error } = await admin
    .from("user_meta_apps")
    .insert({ user_id: user.id, app_name, ig_app_id, ig_app_secret: encryptedSecret })
    .select("id, app_name, ig_app_id, created_at, updated_at")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ app: data }, { status: 201 });
}
