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
      id, user_id, folder_id, account_folder_id, name, is_infinite, cycles, interval_minutes,
      account_stagger_seconds, media_limit, captions, cover_image_url,
      effect_mirror, effect_invert, effect_zoom, effect_blur, effect_noise, effect_anti_ai,
      auto_caption_enabled, auto_caption_type,
      status, created_at,
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
    account_folder_id?: string | null;
    is_infinite: boolean;
    cycles: number;
    interval_minutes: number;
    media_limit: number | null;
    captions: string[];
    cover_image_url: string | null;
    effect_mirror: boolean;
    effect_invert: boolean;
    effect_zoom: boolean;
    effect_blur: boolean;
    effect_noise: boolean;
    effect_anti_ai: boolean;
    auto_caption_enabled?: boolean;
    auto_caption_type?: string | null;
    account_stagger_seconds?: number | null;
    account_ids: string[];
  };

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  const anyAdmin = getSupabaseAdmin() as any;

  const captionsToSave = (body.captions ?? []).map((c: string) => c.trim()).filter(Boolean);
  const autoEnabled = body.auto_caption_enabled ?? false;

  if (!autoEnabled && captionsToSave.length === 0) {
    console.warn(
      `[loops-api] Loop "${body.name?.trim() ?? "?"}" criado SEM legendas configuradas. ` +
      `Posts irão sem legenda até o usuário editar o loop.`
    );
  } else if (autoEnabled) {
    console.log(`[loops-api] Loop "${body.name?.trim() ?? "?"}" — legendas automáticas ativadas (${body.auto_caption_type ?? "curiosidades-gerais"}).`);
  } else {
    console.log(`[loops-api] Loop "${body.name?.trim() ?? "?"}" — ${captionsToSave.length} legenda(s) salva(s): ${JSON.stringify(captionsToSave.slice(0, 3))}`);
  }

  const { data: loop, error: loopError } = await anyAdmin
    .from("loops")
    .insert({
      user_id: user.id,
      folder_id: body.folder_id || null,
      account_folder_id: body.account_folder_id || null,
      name: body.name.trim() || "Meu Loop",
      is_infinite: body.is_infinite,
      cycles: body.cycles,
      interval_minutes: Math.max(10, body.interval_minutes),
      media_limit: body.media_limit ?? null,
      captions: captionsToSave,
      cover_image_url: body.cover_image_url || null,
      effect_mirror:   body.effect_mirror,
      effect_invert:   body.effect_invert,
      effect_zoom:     body.effect_zoom    ?? false,
      effect_blur:     body.effect_blur    ?? false,
      effect_noise:    body.effect_noise   ?? false,
      effect_anti_ai:  body.effect_anti_ai ?? false,
      auto_caption_enabled: autoEnabled,
      auto_caption_type:    autoEnabled ? (body.auto_caption_type ?? "curiosidades-gerais") : null,
      account_stagger_seconds: body.account_stagger_seconds ?? null,
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
