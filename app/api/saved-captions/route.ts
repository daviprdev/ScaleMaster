import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getSupabaseAdmin } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/saved-captions — lista as legendas salvas do usuário autenticado
export async function GET() {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
    return NextResponse.json({ captions: [] });
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });

  const { data, error } = await getSupabaseAdmin()
    .from("saved_captions")
    .select("id, title, content, created_at")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(100);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ captions: data ?? [] });
}

// POST /api/saved-captions — salva uma nova legenda
export async function POST(req: NextRequest) {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
    return NextResponse.json({ caption: { id: "mock", title: null, content: "", created_at: new Date().toISOString() } });
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });

  const { title, content } = await req.json() as { title?: string; content: string };

  if (!content?.trim()) {
    return NextResponse.json({ error: "Conteúdo da legenda é obrigatório." }, { status: 400 });
  }

  const { data, error } = await getSupabaseAdmin()
    .from("saved_captions")
    .insert({ user_id: user.id, title: title?.trim() || null, content: content.trim() })
    .select("id, title, content, created_at")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ caption: data }, { status: 201 });
}

// DELETE /api/saved-captions — remove uma legenda salva pelo id
export async function DELETE(req: NextRequest) {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
    return NextResponse.json({ success: true });
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });

  const { id } = await req.json() as { id: string };
  if (!id) return NextResponse.json({ error: "id obrigatório." }, { status: 400 });

  const { error } = await getSupabaseAdmin()
    .from("saved_captions")
    .delete()
    .eq("id", id)
    .eq("user_id", user.id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ success: true });
}
