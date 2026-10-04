import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import crypto from "crypto";
import { getAppUrl } from "@/lib/app-url";

export const dynamic = "force-dynamic";

/**
 * POST /api/onboarding/magic-token
 * Gera um token único de magic link para vincular conta Instagram via RPA worker.
 * Auth: sessão Supabase do usuário logado.
 * Retorna: { token, url }
 */
export async function POST() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  }

  const admin = getSupabaseAdmin();
  const newToken = crypto.randomUUID();

  const { data, error } = await admin
    .from("onboarding_magic_tokens")
    .insert({
      user_id: user.id,
      token: newToken,
      status: "pending",
    })
    .select("token")
    .single();

  if (error || !data) {
    console.error("[onboarding/magic-token] insert error:", error?.message);
    return NextResponse.json({ error: "Erro ao gerar token" }, { status: 500 });
  }

  const appUrl = getAppUrl();

  return NextResponse.json({
    token: data.token,
    url: `${appUrl}/add/${data.token}`,
  });
}