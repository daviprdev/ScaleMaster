import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { loadFilaList } from "@/lib/fila/load";
import type { FilaListResponse } from "@/lib/fila/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * GET /api/fila — pastas do seletor da aba Fila: só as que têm fila rodando
 * (campanha ativa do Postar ou Loop ativo), a mais movimentada primeiro. Só lê.
 */
export async function GET() {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
    return NextResponse.json({ folders: [], defaultFolderId: null } satisfies FilaListResponse);
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });

  const startedAt = Date.now();
  try {
    const list = await loadFilaList(getSupabaseAdmin(), user.id, new Date());
    console.log(`[fila] lista: ${list.folders.length} pasta(s) com fila rodando em ${Date.now() - startedAt}ms`);
    return NextResponse.json(list satisfies FilaListResponse);
  } catch (e) {
    console.error(`[fila] lista falhou: ${(e as Error).message}`);
    return NextResponse.json({ error: "Não foi possível carregar as filas. Tente de novo." }, { status: 500 });
  }
}
