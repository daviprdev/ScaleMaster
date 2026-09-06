import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getSupabaseAdmin } from "@/lib/supabase";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) return NextResponse.json({ success: true });

  const { id } = await params;

  let body: { name?: string };
  try {
    body = await req.json() as { name?: string };
  } catch {
    return NextResponse.json({ error: "Corpo da requisição inválido." }, { status: 400 });
  }

  const name = body.name;
  if (!name?.trim()) return NextResponse.json({ error: "Nome obrigatório." }, { status: 400 });

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  const { error } = await supabase
    .from("library_folders")
    .update({ name: name.trim() })
    .eq("id", id)
    .eq("user_id", user.id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}

/**
 * DELETE /api/library/folders/[id]
 *
 * Exclui APENAS a pasta. Os vídeos NÃO são apagados — nem do banco, nem do
 * Storage: a FK `videos_library.folder_id ON DELETE SET NULL` move todos eles
 * para "Sem pasta" automaticamente.
 *
 * Comportamento anterior (removido em 2026-09-06): a rota apagava os arquivos
 * do Storage e as linhas de `videos_library` antes de excluir a pasta. Além de
 * destruir mídia que o usuário não pediu para excluir, isso tornava a operação
 * O(n) — com 961 vídeos a função estourava o tempo limite da Vercel e a
 * exclusão simplesmente nunca acontecia (a pasta "SUSANA" nunca saía da tela).
 *
 * Efeitos colaterais tratados aqui:
 *   - Loops que usavam a pasta são PAUSADOS com motivo legível (sem isso
 *     ficariam ativos com folder_id = NULL, falhando em silêncio a cada ciclo).
 *   - Campanhas sincronizadas com a pasta (distribute_campaigns) são removidas
 *     pela FK CASCADE: para o mecanismo de matrícula de contas novas, mas os
 *     posts já agendados continuam intactos (não referenciam a pasta).
 */
export async function DELETE(
  _: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) return NextResponse.json({ success: true });

  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  // Ownership: nunca excluir pasta de outro usuário, mesmo conhecendo o UUID.
  const { data: folder } = await supabase
    .from("library_folders")
    .select("id, name")
    .eq("id", id)
    .eq("user_id", user.id)
    .maybeSingle();

  if (!folder) return NextResponse.json({ error: "Pasta não encontrada." }, { status: 404 });

  const admin = getSupabaseAdmin();

  // Quantos vídeos vão para "Sem pasta" (contagem exata, sem trazer as linhas).
  const { count: videoCount } = await admin
    .from("videos_library")
    .select("id", { count: "exact", head: true })
    .eq("folder_id", id);

  // Loops que dependiam desta pasta: pausa ANTES do delete, enquanto ainda dá
  // para identificá-los por folder_id (a FK zera a referência no delete).
  let pausedLoops: string[] = [];
  try {
    const { data: paused } = await (admin as unknown as {
      from: (t: string) => {
        update: (v: Record<string, unknown>) => {
          eq: (c: string, v: string) => {
            eq: (c: string, v: string) => {
              select: (s: string) => Promise<{ data: { name: string }[] | null }>;
            };
          };
        };
      };
    })
      .from("loops")
      .update({
        status: "paused",
        paused_reason: `Pasta de mídia "${(folder as { name: string }).name}" foi removida.`,
      })
      .eq("folder_id", id)
      .eq("status", "active")
      .select("name");

    pausedLoops = (paused ?? []).map((l) => l.name);
  } catch (e) {
    // Coluna paused_reason ausente não pode impedir a exclusão da pasta.
    console.warn("[folder DELETE] falha ao pausar loops da pasta:", (e as Error).message);
  }

  // Campanhas sincronizadas que serão desligadas pela CASCADE — só para
  // informar o usuário no retorno.
  const { count: syncedCampaigns } = await admin
    .from("distribute_campaigns")
    .select("id", { count: "exact", head: true })
    .eq("video_folder_id", id);

  // DELETE da pasta. Os vídeos passam a folder_id = NULL pela própria FK —
  // nenhum arquivo do Storage é tocado.
  const { error } = await supabase
    .from("library_folders")
    .delete()
    .eq("id", id)
    .eq("user_id", user.id);

  if (error) {
    console.error("[folder DELETE] erro ao excluir a pasta:", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  console.log(
    `[library] pasta ${id.slice(0, 8)}… excluída | videos_movidos=${videoCount ?? 0} ` +
    `loops_pausados=${pausedLoops.length} campanhas_sync_removidas=${syncedCampaigns ?? 0}`
  );

  return NextResponse.json({
    success: true,
    videos_moved: videoCount ?? 0,
    paused_loops: pausedLoops,
    synced_campaigns_removed: syncedCampaigns ?? 0,
  });
}
