import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";

export const dynamic = "force-dynamic";

/**
 * GET /api/admin/rpa/apps
 * Lista todos os apps Meta cadastrados no SaaS para o seletor de app no modal RPA.
 * Retorna: [{ id, ig_app_id, user_id }]
 */
export async function GET() {
  try {
    const admin = getSupabaseAdmin();
    const { data, error } = await admin
      .from("user_meta_apps")
      .select("id, ig_app_id, app_name, user_id")
      .order("created_at", { ascending: false });

    if (error) {
      console.error("[rpa/apps] query error:", error.message);
      return NextResponse.json({ error: "Erro ao buscar apps" }, { status: 500 });
    }

    return NextResponse.json(data ?? []);
  } catch (e) {
    console.error("[rpa/apps] error:", e);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}