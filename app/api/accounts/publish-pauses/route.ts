import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { listPublishPauses } from "@/lib/publish-limits";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Contas do usuário pausadas agora pelo limite de publicação da Meta
 * (lib/publish-limits). O estado vive na memória do servidor — o mesmo
 * processo que roda os crons — então esta rota lê direto de lá.
 */
export async function GET() {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
    return NextResponse.json({ pauses: {} });
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  const { data, error } = await supabase
    .from("instagram_accounts")
    .select("id")
    .eq("user_id", user.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const ids = ((data ?? []) as { id: string }[]).map((r) => r.id);
  return NextResponse.json({ pauses: listPublishPauses(ids) });
}
