import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getSupabaseAdmin } from "@/lib/supabase";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

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
 * Exclusão TOTAL: apaga a pasta E todos os vídeos dentro dela — linhas de
 * `videos_library` E os arquivos no Storage. Não sobra nada (nem "Sem pasta").
 *
 * Decisão do dono (2026-09-08): excluir pasta = apagar tudo de vez. Reverte a
 * semântica anterior de "mover para Sem pasta".
 *
 * A parte de banco roda na RPC `delete_library_folder_cascade` — UMA transação:
 * ownership, pausa de Loops dependentes, coleta dos storage_paths, DELETE dos
 * vídeos e DELETE da pasta ficam atômicos. As FKs para `videos_library`
 * (scheduled_posts/pending_containers/video_variants → SET NULL,
 * video_processing_jobs → CASCADE) não quebram nada: posts em andamento carregam
 * a própria `video_url` e continuam publicando.
 *
 * Os arquivos do Storage são removidos DEPOIS do DELETE do banco (best-effort,
 * em lotes). Se a função morrer no meio da limpeza do Storage, o que sobra é
 * arquivo órfão (invisível, removível pela limpeza de admin) — nunca registro
 * quebrado.
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
        videos_deleted?: number;
        storage_paths?: string[];
        paused_loops?: string[];
        synced_campaigns_removed?: number;
      } | null;
      error: { message: string } | null;
    }>;
  }).rpc("delete_library_folder_cascade", { p_folder_id: id, p_user_id: user.id });

  if (error) {
    console.error("[library] falha ao excluir pasta:", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (!data?.ok) {
    // Ownership é validado dentro da RPC — pasta de outro usuário cai aqui.
    return NextResponse.json({ error: "Pasta não encontrada." }, { status: 404 });
  }

  // Storage DEPOIS do banco — lotes de 100 (limite da Storage API), em paralelo.
  const paths = (data.storage_paths ?? []).filter(Boolean);
  if (paths.length > 0) {
    const BATCH = 100;
    const batches: string[][] = [];
    for (let i = 0; i < paths.length; i += BATCH) batches.push(paths.slice(i, i + BATCH));
    await Promise.all(
      batches.map(batch =>
        admin.storage.from("videos-library").remove(batch)
          .then(({ error: e }) => {
            if (e && !e.message.toLowerCase().includes("not found")) {
              console.error("[library] arquivo órfão no Storage:", e.message);
            }
          })
          .catch(err => console.error("[library] lote de Storage falhou:", err))
      )
    );
  }

  console.log(
    `[library] pasta ${id.slice(0, 8)}… EXCLUÍDA COM VÍDEOS | apagados=${data.videos_deleted ?? 0} ` +
    `arquivos=${paths.length} loops_pausados=${data.paused_loops?.length ?? 0} ` +
    `campanhas_sync_removidas=${data.synced_campaigns_removed ?? 0}`
  );

  return NextResponse.json({
    success: true,
    videos_deleted: data.videos_deleted ?? 0,
    paused_loops: data.paused_loops ?? [],
    synced_campaigns_removed: data.synced_campaigns_removed ?? 0,
  });
}
