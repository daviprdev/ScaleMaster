import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { loadAccountQueues } from "@/lib/fila/load";
import type { AccountQueuesResponse } from "@/lib/fila/account-queues";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * GET /api/accounts/queues — contas do usuário que já estão numa fila do Postar
 * ou Loop ativa ou pausada (o verde dos seletores de contas). Só lê.
 */
export async function GET() {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
    return NextResponse.json({ accounts: {} } satisfies AccountQueuesResponse);
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });

  try {
    return NextResponse.json((await loadAccountQueues(getSupabaseAdmin(), user.id)) satisfies AccountQueuesResponse);
  } catch (e) {
    console.error(`[fila] contas em fila falhou: ${(e as Error).message}`);
    return NextResponse.json({ error: "Não foi possível ler as filas das contas." }, { status: 500 });
  }
}
