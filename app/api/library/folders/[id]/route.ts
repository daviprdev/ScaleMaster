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
 * exclusão simplesmente nunca acontecia.
 *
 * Toda a mutação acontece dentro da RPC `delete_library_folder_safe`, que é uma
 * função plpgsql — logo, UMA transação. Ownership, pausa dos Loops dependentes,
 * coleta de métricas e o DELETE ficam no mesmo bloco atômico: se qualquer etapa
 * falhar, nada é aplicado (sem Loop pausado com a pasta ainda existindo).
 *
 * Campanhas sincronizadas com a pasta são desligadas pela FK CASCADE; os posts
 * já agendados continuam intactos (não referenciam a pasta).
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

  const admin = getSupabaseAdmin();

  // Uma única chamada = uma única transação no Postgres.
  const { data, error } = await (admin as unknown as {
    rpc: (fn: string, args: Record<string, unknown>) => Promise<{
      data: {
        ok: boolean;
        error?: string;
        folder_name?: string;
        videos_moved?: number;
        paused_loops?: string[];
        synced_campaigns_removed?: number;
      } | null;
      error: { message: string } | null;
    }>;
  }).rpc("delete_library_folder_safe", { p_folder_id: id, p_user_id: user.id });

  if (error) {
    console.error("[library] falha ao excluir pasta:", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (!data?.ok) {
    // Ownership é validado dentro da RPC — pasta de outro usuário cai aqui.
    return NextResponse.json({ error: "Pasta não encontrada." }, { status: 404 });
  }

  console.log(
    `[library] pasta ${id.slice(0, 8)}… excluída | videos_movidos=${data.videos_moved ?? 0} ` +
    `loops_pausados=${data.paused_loops?.length ?? 0} campanhas_sync_removidas=${data.synced_campaigns_removed ?? 0}`
  );

  return NextResponse.json({
    success: true,
    videos_moved: data.videos_moved ?? 0,
    paused_loops: data.paused_loops ?? [],
    synced_campaigns_removed: data.synced_campaigns_removed ?? 0,
  });
}
