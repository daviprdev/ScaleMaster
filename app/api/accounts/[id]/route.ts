import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

// PATCH /api/accounts/[id] — update account fields (folder_id, etc.)
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  if (!id) {
    return NextResponse.json({ error: "'id' é obrigatório." }, { status: 400 });
  }

  const body = await req.json() as Record<string, unknown>;
  const allowedFields = ["folder_id", "is_active"];
  const updates: Record<string, unknown> = {};

  for (const field of allowedFields) {
    if (field in body) updates[field] = body[field];
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

  return NextResponse.json({ success: true });
}
