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

  // NUNCA selecionar credencial aqui: esta rota é consumida direto por
  // componentes de browser (Postar, Loop, Clone, Stories, Links, PostModal) e
  // tudo que entra no SELECT é serializado para o cliente.
  //
  // `access_token` esteve nesta lista desde a Fase 15 (era instagrapi), quando
  // o PostModal usava `!!acc.access_token` só para saber se a conta tinha
  // sessão salva — ou seja, o browser precisava de um BOOLEANO e recebia o JSON
  // completo da sessão (cookies, device_id). Depois da migração para OAuth da
  // Meta (Fases 27/28) nem esse uso sobrou: nenhum consumidor lê o campo.
  //
  // Se algum dia a UI precisar saber que a conta tem credencial, exponha um
  // booleano derivado no servidor — nunca o token.
  const { data, error } = await getSupabaseAdmin()
    .from("instagram_accounts")
    .select("id, username, display_name, avatar_url, is_active, ig_business_account_id, health_status, folder_id, account_folders(name)")
    .eq("user_id", user.id)
    .order("connected_at", { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ accounts: data ?? [] });
}
