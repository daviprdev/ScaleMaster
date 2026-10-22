import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { analyzeQueue } from "@/lib/queue-insights/analyze";
import { loadQueueInsightsInput, UUID_RE } from "@/lib/queue-insights/load";
import type { QueueInsightsResponse, QueueSource } from "@/lib/queue-insights/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * GET /api/queue-insights/[source]/[id] — Raio-X de uma fila (postar = campanha
 * do Postar, loop = Loop) do usuário: números do topo, post indo bem agora e a
 * fila ideal. Só lê: lê o banco (lib/queue-insights/load) e calcula
 * (lib/queue-insights/analyze). Regras em docs/fila-ideal.md.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ source: string; id: string }> }
) {
  const { source, id } = await params;
  if (source !== "postar" && source !== "loop") {
    return NextResponse.json({ error: "Fila inválida." }, { status: 400 });
  }
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ error: "Fila inválida." }, { status: 400 });
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });

  const tag = `[queue-insights] ${source}/${id.slice(0, 8)}`;
  const now = new Date();
  const startedAt = Date.now();

  let loaded: Awaited<ReturnType<typeof loadQueueInsightsInput>>;
  try {
    loaded = await loadQueueInsightsInput(getSupabaseAdmin(), user.id, source as QueueSource, id, now);
  } catch (e) {
    console.error(`${tag}: leitura falhou após ${Date.now() - startedAt}ms: ${(e as Error).message}`);
    return NextResponse.json({ error: "Não foi possível ler os dados dessa fila. Tente de novo." }, { status: 500 });
  }
  if (!loaded) return NextResponse.json({ error: "Fila não encontrada." }, { status: 404 });

  const loadMs = Date.now() - startedAt;
  let body: QueueInsightsResponse;
  try {
    body = analyzeQueue(loaded.input, now);
  } catch (e) {
    console.error(`${tag}: cálculo falhou: ${(e as Error).message}`);
    return NextResponse.json({ error: "Não foi possível analisar essa fila. Tente de novo." }, { status: 500 });
  }

  const s = loaded.stats;
  console.log(
    `${tag}: leitura ${loadMs}ms (${s.requests} req, ${s.queuePosts} posts da fila, ${s.videos} vídeos) | ` +
    `cálculo ${Date.now() - startedAt - loadMs}ms`
  );

  return NextResponse.json(body);
}
