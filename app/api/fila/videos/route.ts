import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { PAUSE_SQL_FILE } from "@/lib/fila/pause";
import { UUID_RE, isMissingSchemaError } from "@/lib/queue-insights/load";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Vídeos por chamada (a tela manda um por clique). */
const MAX_IDS = 200;

interface PauseBody {
  ids?: unknown;
  paused?: unknown;
}

/**
 * PATCH /api/fila/videos — pausa (`paused: true`) ou reativa vídeos da fila.
 * Grava videos_library.queue_paused_at dos vídeos do usuário; quem respeita a
 * pausa são o Postar, o Loop e o publish-scheduled (lib/fila/pause).
 */
export async function PATCH(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });

  const body = (await req.json().catch(() => null)) as PauseBody | null;
  const ids = body?.ids;
  if (
    !Array.isArray(ids) || ids.length < 1 || ids.length > MAX_IDS ||
    ids.some((id) => typeof id !== "string" || !UUID_RE.test(id))
  ) {
    return NextResponse.json({ error: "Vídeos inválidos." }, { status: 400 });
  }
  if (typeof body?.paused !== "boolean") {
    return NextResponse.json({ error: "Informe se o vídeo fica pausado ou ativo." }, { status: 400 });
  }

  const pausedAt = body.paused ? new Date().toISOString() : null;
  const { data, error } = await getSupabaseAdmin()
    .from("videos_library")
    .update({ queue_paused_at: pausedAt })
    .eq("user_id", user.id)
    .in("id", Array.from(new Set(ids as string[])))
    .select("id");

  if (error) {
    if (isMissingSchemaError(error)) {
      return NextResponse.json(
        { error: `Para pausar vídeos falta aplicar o SQL ${PAUSE_SQL_FILE} no Supabase.`, code: "sql_pending" },
        { status: 409 },
      );
    }
    console.error(`[fila] pausa falhou: ${error.message}`);
    return NextResponse.json({ error: "Não foi possível salvar. Tente de novo." }, { status: 500 });
  }

  const updated = ((data ?? []) as { id: string }[]).map((r) => r.id);
  if (!updated.length) return NextResponse.json({ error: "Vídeo não encontrado." }, { status: 404 });

  console.log(`[fila] ${body.paused ? "pausado" : "reativado"}: ${updated.length} vídeo(s) do usuário ${user.id.slice(0, 8)}`);
  return NextResponse.json({ ids: updated, pausedAt });
}
