import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getSupabaseAdmin } from "@/lib/supabase";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
    return NextResponse.json({ loops: [] });
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  // Tabela nova não existe nos tipos gerados — cast necessário
  const admin = getSupabaseAdmin() as unknown as Record<string, (...args: unknown[]) => unknown>;
  const query = (admin.from as (t: string) => {
    select: (s: string) => {
      eq: (c: string, v: string) => {
        order: (c: string, o: object) => Promise<{ data: unknown[] | null; error: { message: string } | null }>
      }
    }
  })("loops")
    .select(`
      id, user_id, folder_id, name, is_infinite, cycles, interval_minutes,
      media_limit, captions, cover_image_url, effect_mirror, effect_invert, status, created_at,
      loop_accounts ( account_id, instagram_accounts ( id, username, display_name, avatar_url ) ),
      library_folders ( id, name )
    `)
    .eq("user_id", user.id)
    .order("created_at", { ascending: false });

  const { data, error } = await query;

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ loops: data ?? [] });
}

export async function POST(req: NextRequest) {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
    return NextResponse.json({ loop: { id: `mock_${Date.now()}`, status: "active" } });
  }

  const body = await req.json() as {
    name: string;
    folder_id: string | null;
    is_infinite: boolean;
    cycles: number;
    interval_minutes: number;
    media_limit: number | null;
    captions: string[];
    cover_image_url: string | null;
    effect_mirror: boolean;
    effect_invert: boolean;
    account_ids: string[];
  };

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  const anyAdmin = getSupabaseAdmin() as any;

  const { data: loop, error: loopError } = await anyAdmin
    .from("loops")
    .insert({
      user_id: user.id,
      folder_id: body.folder_id || null,
      name: body.name.trim() || "Meu Loop",
      is_infinite: body.is_infinite,
      cycles: body.cycles,
      interval_minutes: Math.max(10, body.interval_minutes),
      media_limit: body.media_limit ?? null,
      captions: body.captions.filter((c: string) => c.trim()),
      cover_image_url: body.cover_image_url || null,
      effect_mirror: body.effect_mirror,
      effect_invert: body.effect_invert,
      status: "active",
    })
    .select()
    .single();

  if (loopError) return NextResponse.json({ error: loopError.message }, { status: 500 });

  if (body.account_ids.length > 0) {
    const { error: accError } = await anyAdmin
      .from("loop_accounts")
      .insert(body.account_ids.map((accountId: string) => ({
        loop_id: loop.id,
        account_id: accountId,
      })));
    if (accError) return NextResponse.json({ error: accError.message }, { status: 500 });
  }

  return NextResponse.json({ loop });
}
