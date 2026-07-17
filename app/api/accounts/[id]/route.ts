import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { encrypt } from "@/lib/encrypt";

export const runtime = "nodejs";

// PATCH /api/accounts/[id] — update account fields (folder_id, is_active, proxy_url)
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  if (!id) {
    return NextResponse.json({ error: "'id' é obrigatório." }, { status: 400 });
  }

  const body = await req.json() as Record<string, unknown>;
  const updates: Record<string, unknown> = {};

  for (const field of ["folder_id", "is_active"]) {
    if (field in body) updates[field] = body[field];
  }

  // proxy_url: aceita string (plain URL → encripta) ou null (remove proxy)
  if ("proxy_url" in body) {
    const raw = body.proxy_url;
    if (raw === null || raw === "") {
      updates.proxy_url = null;
    } else if (typeof raw === "string") {
      try {
        updates.proxy_url = encrypt(raw.trim());
      } catch {
        return NextResponse.json({ error: "Falha ao encriptar a URL do proxy." }, { status: 500 });
      }
    }
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "Nenhum campo válido para atualizar." }, { status: 400 });
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("instagram_accounts")
    .update(updates)
    .eq("id", id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Consumo único do estoque: se o proxy da conta foi removido ou trocado
  // manualmente, a entrada do estoque atribuída a ela é DELETADA — proxy que
  // já pertenceu a uma conta nunca volta a ser distribuído.
  if ("proxy_url" in body) {
    const { error: poolErr } = await supabase
      .from("proxy_pool")
      .delete()
      .eq("assigned_account_id", id);
    if (poolErr) console.warn(`[accounts/${id}] Falha ao consumir entrada do estoque:`, poolErr.message);
  }

  return NextResponse.json({ success: true });
}
