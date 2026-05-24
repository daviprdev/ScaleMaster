import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

// GET /api/accounts/list — lista contas do Instagram do usuário autenticado
export async function GET() {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
    return NextResponse.json({ accounts: [] });
  }

  const supabaseUser = await createClient();
  const { data: { user } } = await supabaseUser.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Não autenticado." }, { status: 401 });
  }

  const { data, error } = await getSupabaseAdmin()
    .from("instagram_accounts")
    .select("id, username, display_name, avatar_url, is_active, access_token, ig_business_account_id, health_status, folder_id, account_folders(name)")
    .eq("user_id", user.id)
    .order("connected_at", { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ accounts: data ?? [] });
}
