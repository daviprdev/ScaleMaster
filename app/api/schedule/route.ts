import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getSupabaseAdmin } from "@/lib/supabase";

export const runtime = "nodejs";

// POST /api/schedule — cria postagens agendadas para múltiplas contas
export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });

  const body = await req.json() as {
    video_id: string;
    account_ids: string[];
    caption: string;
    scheduled_at: string; // ISO string
  };

  const { video_id, account_ids, caption, scheduled_at } = body;

  if (!video_id || !account_ids?.length || !scheduled_at) {
    return NextResponse.json(
      { error: "Campos 'video_id', 'account_ids' e 'scheduled_at' são obrigatórios." },
      { status: 400 }
    );
  }

  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
    // Mock: simula agendamento para cada conta
    const mockPosts = account_ids.map((account_id) => ({
      id: `mock_post_${Date.now()}_${account_id}`,
      video_id,
      account_id,
      caption,
      scheduled_at,
      status: "pending",
      created_at: new Date().toISOString(),
    }));
    return NextResponse.json({ success: true, posts: mockPosts, mock: true });
  }

  const admin = getSupabaseAdmin();

  // Valida ownership da conta e do vídeo antes de inserir — sem isso, um
  // account_id/video_id de outro usuário (vazado ou adivinhado) permitia
  // agendar posts na conta/vídeo de terceiros.
  const [{ data: ownedAccountRows }, { data: ownedVideo }] = await Promise.all([
    admin.from("instagram_accounts").select("id").in("id", account_ids).eq("user_id", user.id),
    admin.from("videos_library").select("id").eq("id", video_id).eq("user_id", user.id).single(),
  ]);
  const ownedAccountIds = new Set((ownedAccountRows ?? []).map((a: { id: string }) => a.id));
  const notOwnedAccounts = account_ids.filter((id) => !ownedAccountIds.has(id));
  if (notOwnedAccounts.length > 0) {
    return NextResponse.json(
      { error: "Uma ou mais contas não pertencem a este usuário." },
      { status: 403 }
    );
  }
  if (!ownedVideo) {
    return NextResponse.json({ error: "Vídeo não encontrado." }, { status: 404 });
  }

  // Cria um registro por conta selecionada
  const records = account_ids.map((account_id) => ({
    user_id: user.id,
    video_id,
    account_id,
    caption,
    scheduled_at,
    status: "pending",
  }));

  const { data, error } = await admin
    .from("scheduled_posts")
    .insert(records)
    .select();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true, posts: data });
}

// GET /api/schedule — lista postagens agendadas
export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });

  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
    return NextResponse.json({ posts: [] });
  }

  const { data, error } = await getSupabaseAdmin()
    .from("scheduled_posts")
    .select("*, instagram_accounts(username, display_name, avatar_url), videos_library(filename, public_url)")
    .eq("user_id", user.id)
    .order("scheduled_at", { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ posts: data });
}
