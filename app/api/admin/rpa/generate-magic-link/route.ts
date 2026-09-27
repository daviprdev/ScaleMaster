import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import crypto from "crypto";

export const dynamic = "force-dynamic";

const APP_URL = (process.env.NEXT_PUBLIC_APP_URL ?? "https://autoscale-ia.vercel.app").replace(/\/$/, "");

/**
 * POST /api/admin/rpa/generate-magic-link
 * Gera um magic link token automaticamente para o worker RPA.
 * Body: { user_id?: string, app_id?: string }
 * Retorna: { token, magic_url }
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const userId = body.user_id as string | undefined;
    const appId = body.app_id as string | undefined;

    // Se não passar user_id, usa o primeiro admin ou um user padrão
    const admin = getSupabaseAdmin();

    let resolvedUserId = userId;
    if (!resolvedUserId) {
      // Busca o primeiro usuário admin como fallback
      const { data: users } = await admin
        .from("user_roles")
        .select("user_id")
        .eq("role", "admin")
        .limit(1);
      if (users && users.length > 0) {
        resolvedUserId = users[0].user_id;
      } else {
        return NextResponse.json(
          { error: "Nenhum usuário encontrado. Forneça user_id." },
          { status: 400 }
        );
      }
    }

    // Valida app_id se fornecido
    if (appId) {
      const { data: app } = await admin
        .from("user_meta_apps")
        .select("id")
        .eq("id", appId)
        .eq("user_id", resolvedUserId)
        .single();
      if (!app) {
        return NextResponse.json({ error: "App não encontrado" }, { status: 404 });
      }
    }

    // Gera novo token
    const newToken = crypto.randomUUID();
    const now = new Date().toISOString();

    const { error } = await admin
      .from("magic_add_tokens")
      .upsert(
        { user_id: resolvedUserId, app_id: appId ?? null, token: newToken, updated_at: now },
        { onConflict: "user_id" }
      );

    if (error) {
      console.error("[rpa/generate-magic-link] upsert error:", error.message);
      return NextResponse.json({ error: "Erro ao gerar token" }, { status: 500 });
    }

    return NextResponse.json({
      token: newToken,
      magic_url: `${APP_URL}/add/${newToken}`,
    });
  } catch (e) {
    console.error("[rpa/generate-magic-link] error:", e);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}