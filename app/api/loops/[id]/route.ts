import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { normalizeProcessingMode } from "@/lib/video-processing";
import { normalizeCaptionMode } from "@/lib/reel-captions";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) return NextResponse.json({ success: true });

  const { id } = await params;
  const body = await req.json() as Record<string, unknown>;

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  const anyAdmin = getSupabaseAdmin() as any;

  // BUG CRÍTICO corrigido: antes, um PATCH só com { account_ids } pulava o
  // bloco de update escalar (que tinha o único .eq("user_id", ...)) e ia direto
  // pro delete+insert de loop_accounts sem NENHUMA checagem de dono — qualquer
  // usuário conseguia sequestrar o loop de outro trocando as contas dele.
  const { data: ownedLoop } = await anyAdmin
    .from("loops")
    .select("id")
    .eq("id", id)
    .eq("user_id", user.id)
    .single();
  if (!ownedLoop) return NextResponse.json({ error: "Não encontrado" }, { status: 404 });

  const updatePayload: Record<string, unknown> = {};
  const scalars = ["status", "name", "folder_id", "account_folder_id", "is_infinite", "cycles",
    "interval_minutes", "media_limit", "captions", "cover_image_url",
    "effect_mirror", "effect_invert", "effect_zoom", "effect_blur", "effect_noise", "effect_anti_ai",
    "auto_caption_enabled", "auto_caption_type", "account_stagger_seconds",
    "video_processing_mode", "share_to_feed",
    "caption_mode", "caption_strip_hashtags", "caption_strip_mentions"];
  for (const key of scalars) {
    if (!(key in body)) continue;

    if (key === "caption_mode") {
      // Só afeta containers criados a partir daqui — os já enviados
      // guardam o texto que valia na época (snapshot).
      updatePayload[key] = normalizeCaptionMode(body[key]);
      continue;
    }

    if (key === "caption_strip_hashtags" || key === "caption_strip_mentions") {
      updatePayload[key] = body[key] === true;
      continue;
    }

    if (key === "share_to_feed") {
      // Só afeta containers criados a partir daqui — os já enviados guardam o
      // valor que valia na época. Booleano explícito ou null (não enviar).
      updatePayload[key] = typeof body[key] === "boolean" ? body[key] : null;
      continue;
    }

    if (key === "video_processing_mode") {
      // Só afeta publicações CRIADAS a partir daqui — posts/containers já
      // agendados guardam a decisão que valia no momento em que nasceram.
      updatePayload[key] = normalizeProcessingMode(body[key]);
      continue;
    }

    if (key === "captions") {
      // Legenda vem EXCLUSIVAMENTE da configuração do loop (campo preenchido pelo usuário no UI).
      // NUNCA deve vir dos metadados do vídeo (videos_library.caption é NULL para vídeos raspados).
      const raw = body[key];
      const cleaned = Array.isArray(raw)
        ? (raw as string[]).map(c => String(c ?? "").trim()).filter(Boolean)
        : [];
      updatePayload[key] = cleaned;
      if (cleaned.length === 0) {
        console.warn(
          `[loops-api] PATCH loop ${id} — captions atualizado para ARRAY VAZIO. ` +
          `Posts futuros deste loop irão sem legenda até novas legendas serem adicionadas.`
        );
      } else {
        console.log(`[loops-api] PATCH loop ${id} — ${cleaned.length} legenda(s): ${JSON.stringify(cleaned.slice(0, 3))}`);
      }
      continue;
    }

    updatePayload[key] = body[key];
  }

  // Mesma checagem de ownership de pasta/conta do POST — evita que a edição de
  // um loop já próprio seja usada pra apontar pra pasta/conta de outro usuário.
  const accountIdsInBody = "account_ids" in body ? (body.account_ids as string[]) : [];
  const [libFolderCheck, accFolderCheck, accountsCheck] = await Promise.all([
    updatePayload.folder_id
      ? anyAdmin.from("library_folders").select("id").eq("id", updatePayload.folder_id).eq("user_id", user.id).single()
      : Promise.resolve({ data: null }),
    updatePayload.account_folder_id
      ? anyAdmin.from("account_folders").select("id").eq("id", updatePayload.account_folder_id).eq("user_id", user.id).single()
      : Promise.resolve({ data: null }),
    accountIdsInBody.length
      ? anyAdmin.from("instagram_accounts").select("id").in("id", accountIdsInBody).eq("user_id", user.id)
      : Promise.resolve({ data: [] }),
  ]);
  if (updatePayload.folder_id && !libFolderCheck.data) {
    return NextResponse.json({ error: "Pasta de mídia não encontrada." }, { status: 400 });
  }
  if (updatePayload.account_folder_id && !accFolderCheck.data) {
    return NextResponse.json({ error: "Pasta de contas não encontrada." }, { status: 400 });
  }
  if (accountIdsInBody.length) {
    const ownedAccountIds = new Set(((accountsCheck.data ?? []) as { id: string }[]).map((a) => a.id));
    const notOwnedAccounts = accountIdsInBody.filter((accId) => !ownedAccountIds.has(accId));
    if (notOwnedAccounts.length > 0) {
      return NextResponse.json({ error: "Uma ou mais contas não pertencem a este usuário." }, { status: 403 });
    }
  }

  if (Object.keys(updatePayload).length > 0) {
    const { error } = await anyAdmin
      .from("loops")
      .update(updatePayload)
      .eq("id", id)
      .eq("user_id", user.id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if ("account_ids" in body) {
    const accountIds = body.account_ids as string[];
    await anyAdmin.from("loop_accounts").delete().eq("loop_id", id);
    if (accountIds.length > 0) {
      const { error } = await anyAdmin
        .from("loop_accounts")
        .insert(accountIds.map((accId: string) => ({ loop_id: id, account_id: accId })));
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    }
  }

  return NextResponse.json({ success: true });
}

export async function DELETE(
  _: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) return NextResponse.json({ success: true });

  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  const admin = getSupabaseAdmin() as any;

  // Cancela containers pendentes ANTES de deletar o loop.
  // Sem isso, ON DELETE SET NULL faz loop_id=NULL nos containers — eles ficam
  // presos na fila do publish-pending e bloqueiam postagens do novo loop.
  await admin
    .from("pending_containers")
    .update({ status: "error", error_message: "Loop excluído pelo usuário." })
    .eq("loop_id", id)
    .in("status", ["pending", "publishing"]);

  const { error } = await admin
    .from("loops")
    .delete()
    .eq("id", id)
    .eq("user_id", user.id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
