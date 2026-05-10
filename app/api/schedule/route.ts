import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";

export const runtime = "nodejs";

// POST /api/schedule — cria postagens agendadas para múltiplas contas
export async function POST(req: NextRequest) {
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

  // Cria um registro por conta selecionada
  const records = account_ids.map((account_id) => ({
    user_id: null, // TODO: substituir por auth.uid() na Fase 6
    video_id,
    account_id,
    caption,
    scheduled_at,
    status: "pending",
  }));

  const { data, error } = await getSupabaseAdmin()
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
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
    return NextResponse.json({ posts: [] });
  }

  const { data, error } = await getSupabaseAdmin()
    .from("scheduled_posts")
    .select("*, instagram_accounts(username, display_name, avatar_url), videos_library(filename, public_url)")
    .order("scheduled_at", { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ posts: data });
}
