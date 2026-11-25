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
  const listar = (cols: string) =>
    admin
      .from("user_meta_apps")
      .select(cols)
      .eq("user_id", user.id)
      .order("created_at", { ascending: false });

  let { data, error } = await listar("id, app_name, ig_app_id, config_id, created_at, updated_at");
  // decisão: sem supabase/user_meta_apps_unified.sql a coluna não existe; lista sem ela.
  if (error?.code === "42703") ({ data, error } = await listar("id, app_name, ig_app_id, created_at, updated_at"));

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
  const config_id = String(body.config_id ?? "").trim();

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
    .insert({
      user_id: user.id,
      app_name,
      ig_app_id,
      ig_app_secret: encryptedSecret,
      ...(config_id ? { config_id } : {}),
    })
    .select(config_id ? "id, app_name, ig_app_id, config_id, created_at, updated_at" : "id, app_name, ig_app_id, created_at, updated_at")
    .single();

  if (error?.code === "42703" || error?.code === "PGRST204") {
    return NextResponse.json({ error: "Rode supabase/user_meta_apps_unified.sql no Supabase para usar o Login Unificado." }, { status: 500 });
  }
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ app: data }, { status: 201 });
}
