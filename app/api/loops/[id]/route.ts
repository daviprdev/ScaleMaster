import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getSupabaseAdmin } from "@/lib/supabase";

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

  const updatePayload: Record<string, unknown> = {};
  const scalars = ["status", "name", "folder_id", "account_folder_id", "is_infinite", "cycles",
    "interval_minutes", "media_limit", "captions", "cover_image_url",
    "effect_mirror", "effect_invert", "effect_zoom", "effect_blur", "effect_noise", "effect_anti_ai"];
  for (const key of scalars) {
    if (!(key in body)) continue;

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
