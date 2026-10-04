import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { normalizeProcessingMode } from "@/lib/video-processing";
import { normalizeCaptionMode } from "@/lib/reel-captions";
import { checkCreateReadiness } from "@/lib/loop-readiness";
import { normalizePriorityStrategy } from "@/lib/media-priority";

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
      auto_caption_enabled, auto_caption_type, video_processing_mode, share_to_feed,
      caption_mode, caption_strip_hashtags, caption_strip_mentions,
      priority_strategy, distribution_seed,
      status, created_at, last_skip_reason, last_skip_at,
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
    video_processing_mode?: string;
    share_to_feed?: boolean;
    caption_mode?: string;
    caption_strip_hashtags?: boolean;
    caption_strip_mentions?: boolean;
    account_ids: string[];
  };

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  const anyAdmin = getSupabaseAdmin() as any;

  // Valida ownership de pasta de mídia, pasta de contas e contas específicas
  // antes de criar o loop — sem isso, um folder_id/account_id de outro usuário
  // (vazado/adivinhado) fazia o cron postar conteúdo alheio em contas alheias.
  const accountIdsToCheck: string[] = body.account_ids ?? [];
  const [libFolderCheck, accFolderCheck, accountsCheck] = await Promise.all([
    body.folder_id
      ? anyAdmin.from("library_folders").select("id").eq("id", body.folder_id).eq("user_id", user.id).single()
      : Promise.resolve({ data: null }),
    body.account_folder_id
      ? anyAdmin.from("account_folders").select("id").eq("id", body.account_folder_id).eq("user_id", user.id).single()
      : Promise.resolve({ data: null }),
    accountIdsToCheck.length
      ? anyAdmin.from("instagram_accounts").select("id").in("id", accountIdsToCheck).eq("user_id", user.id)
      : Promise.resolve({ data: [] }),
  ]);
  if (body.folder_id && !libFolderCheck.data) {
    return NextResponse.json({ error: "Pasta de mídia não encontrada." }, { status: 400 });
  }
  if (body.account_folder_id && !accFolderCheck.data) {
    return NextResponse.json({ error: "Pasta de contas não encontrada." }, { status: 400 });
  }
  const ownedAccountIds = new Set(((accountsCheck.data ?? []) as { id: string }[]).map((a) => a.id));
  const notOwnedAccounts = accountIdsToCheck.filter((id) => !ownedAccountIds.has(id));
  if (notOwnedAccounts.length > 0) {
    return NextResponse.json({ error: "Uma ou mais contas não pertencem a este usuário." }, { status: 403 });
  }

  // ── O loop consegue postar? ────────────────────────────────────────────
  // Um loop sem vídeo na pasta (ou sem conta) fica "Ativo" na tela e nunca
  // posta nada: o cron detecta e pula em silêncio. Recusar aqui é o único
  // momento em que o usuário está olhando para a configuração errada.
  const readiness = await checkCreateReadiness(anyAdmin, user.id, {
    folderId: body.folder_id || null,
    accountFolderId: body.account_folder_id || null,
    accountIds: accountIdsToCheck,
  });
  if (!readiness.ok) {
    return NextResponse.json({ error: readiness.reason }, { status: 400 });
  }

  const captionsToSave = (body.captions ?? []).map((c: string) => c.trim()).filter(Boolean);
  const autoEnabled = body.auto_caption_enabled ?? false;
  const priorityStrategy = normalizePriorityStrategy(
    (body as unknown as Record<string, unknown>).priority_strategy as string | undefined,
  );
  // Seed determinística baseada em metadados do loop para reprodutibilidade.
  const distributionSeed = `${user.id}:${body.name.trim()}:${Date.now()}`;

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
      video_processing_mode: normalizeProcessingMode(body.video_processing_mode),
      share_to_feed: typeof body.share_to_feed === "boolean" ? body.share_to_feed : null,
      // Modo de legenda. Ausente = "custom" = pool/automática, que é o
      // comportamento de sempre do Loop.
      caption_mode: normalizeCaptionMode(body.caption_mode),
      caption_strip_hashtags: body.caption_strip_hashtags === true,
      caption_strip_mentions: body.caption_strip_mentions === true,
      priority_strategy: priorityStrategy,
      distribution_seed: distributionSeed,
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
