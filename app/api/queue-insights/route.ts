import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { loadQueueList } from "@/lib/queue-insights/load";
import type { QueueListResponse } from "@/lib/queue-insights/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * GET /api/queue-insights — filas do seletor do Raio-X (campanhas do Postar e
 * Loops): as rodando primeiro, depois pausadas/terminadas que publicaram nos
 * últimos 7 dias, e a fila em que o painel abre. Só lê.
 */
export async function GET() {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
    return NextResponse.json({ queues: [], defaultQueue: null } satisfies QueueListResponse);
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });

  const startedAt = Date.now();
  try {
    const list = await loadQueueList(getSupabaseAdmin(), user.id, new Date());
    console.log(`[queue-insights] lista: ${list.queues.length} fila(s) em ${Date.now() - startedAt}ms`);
    return NextResponse.json(list satisfies QueueListResponse);
  } catch (e) {
    console.error(`[queue-insights] lista falhou: ${(e as Error).message}`);
    return NextResponse.json({ error: "Não foi possível carregar as filas. Tente de novo." }, { status: 500 });
  }
}
