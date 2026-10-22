import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { loadFilaFolder } from "@/lib/fila/load";
import { UUID_RE } from "@/lib/queue-insights/load";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * GET /api/fila/[folderId] — vídeos da pasta com posts, views e média de cada
 * um nas filas rodando da pasta, e quais estão pausados. Só lê.
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ folderId: string }> }) {
  const { folderId } = await params;
  if (!UUID_RE.test(folderId)) {
    return NextResponse.json({ error: "Pasta inválida." }, { status: 400 });
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });

  const startedAt = Date.now();
  try {
    const data = await loadFilaFolder(getSupabaseAdmin(), user.id, folderId, new Date());
    if (!data) return NextResponse.json({ error: "Pasta não encontrada." }, { status: 404 });
    console.log(
      `[fila] pasta ${folderId.slice(0, 8)}: ${data.videos.length} vídeo(s), ${data.queues.length} fila(s), ` +
        `${data.summary.posts} post(s) em ${Date.now() - startedAt}ms`
    );
    return NextResponse.json(data);
  } catch (e) {
    console.error(`[fila] pasta ${folderId.slice(0, 8)} falhou após ${Date.now() - startedAt}ms: ${(e as Error).message}`);
    return NextResponse.json({ error: "Não foi possível ler os vídeos dessa pasta. Tente de novo." }, { status: 500 });
  }
}
