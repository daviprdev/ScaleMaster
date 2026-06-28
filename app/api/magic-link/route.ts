import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getSupabaseAdmin } from "@/lib/supabase";

export const dynamic = "force-dynamic";

// GET — retorna o token atual do usuário (se existir)
export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  const admin = getSupabaseAdmin();
  const { data } = await admin
    .from("magic_add_tokens")
    .select("token, app_id")
    .eq("user_id", user.id)
    .single();

  return NextResponse.json({ token: data?.token ?? null, app_id: data?.app_id ?? null });
}

// POST — gera ou rotaciona o token vinculando ao app selecionado
export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const appId: string | null = body.app_id ?? null;

  const admin = getSupabaseAdmin();

  // Se um app_id for passado, valida que pertence ao usuário
  if (appId) {
    const { data: app } = await admin
      .from("user_meta_apps")
      .select("id")
      .eq("id", appId)
      .eq("user_id", user.id)
      .single();
    if (!app) return NextResponse.json({ error: "App não encontrado" }, { status: 404 });
  }

  // Gera novo UUID de token
  const crypto = await import("crypto");
  const newToken = crypto.randomUUID();
  const now = new Date().toISOString();

  const { data, error } = await admin
    .from("magic_add_tokens")
    .upsert(
      { user_id: user.id, app_id: appId, token: newToken, updated_at: now },
      { onConflict: "user_id" }
    )
    .select("token, app_id")
    .single();

  if (error) {
    console.error("[magic-link] upsert error:", error.message);
    return NextResponse.json({ error: "Erro ao gerar token" }, { status: 500 });
  }

  return NextResponse.json({ token: data.token, app_id: data.app_id });
}
