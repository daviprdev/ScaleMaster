import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) return NextResponse.json({ success: true });

  const { id } = await params;
  const { name } = await req.json() as { name: string };
  if (!name?.trim()) return NextResponse.json({ error: "Nome obrigatório." }, { status: 400 });

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  const { error } = await supabase
    .from("account_folders")
    .update({ name: name.trim() })
    .eq("id", id)
    .eq("user_id", user.id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
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

  // Busca IDs das contas da pasta para limpar dependências
  const { data: accountRows } = await supabase
    .from("instagram_accounts")
    .select("id")
    .eq("folder_id", id)
    .eq("user_id", user.id);

  const accountIdsToDelete = (accountRows ?? []).map((r: { id: string }) => r.id);

  // Limpa pending_containers órfãos antes de deletar as contas
  if (accountIdsToDelete.length > 0) {
    await supabase.from("pending_containers").delete().in("account_id", accountIdsToDelete);
  }

  // Exclui todas as contas da pasta
  const { error: accErr } = await supabase
    .from("instagram_accounts")
    .delete()
    .eq("folder_id", id)
    .eq("user_id", user.id);

  if (accErr) return NextResponse.json({ error: accErr.message }, { status: 500 });

  const { error } = await supabase
    .from("account_folders")
    .delete()
    .eq("id", id)
    .eq("user_id", user.id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
