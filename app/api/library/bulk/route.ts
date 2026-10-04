import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

interface BulkDeleteItem {
  id: string;
  storage_path: string;
}

// DELETE /api/library/bulk — hard delete em lote
// Body: { items: Array<{ id: string; storage_path: string }> }
// Fase 1 (crítica): deleta registros do banco → garante que não "voltam" após F5
// Fase 2 (best-effort): remove arquivos físicos do Storage em paralelo
export async function DELETE(req: NextRequest) {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
    return NextResponse.json({ error: "Supabase não configurado." }, { status: 503 });
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  let body: { items?: BulkDeleteItem[] };
  try {
    body = await req.json() as { items?: BulkDeleteItem[] };
  } catch {
    return NextResponse.json({ error: "Body JSON inválido." }, { status: 400 });
  }

  const items = body.items;
  if (!Array.isArray(items) || items.length === 0) {
    return NextResponse.json({ error: "'items' deve ser um array não vazio." }, { status: 400 });
  }

  const admin = getSupabaseAdmin();

  // ── Fase 0: confirma que os IDs recebidos de fato pertencem ao usuário ──
  const requestedIds = items.map(i => i.id).filter(Boolean);
  if (requestedIds.length === 0) {
    return NextResponse.json({ error: "Nenhum ID válido fornecido." }, { status: 400 });
  }

  const { data: owned, error: ownedError } = await admin
    .from("videos_library")
    .select("id, storage_path")
    .eq("user_id", user.id)
    .in("id", requestedIds);

  if (ownedError) {
    return NextResponse.json({ error: ownedError.message }, { status: 500 });
  }

  const ownedRows = (owned ?? []) as { id: string; storage_path: string }[];
  const ids = ownedRows.map(r => r.id);
  if (ids.length === 0) {
    return NextResponse.json({ error: "Nenhum ID válido fornecido." }, { status: 400 });
  }

  // ── Fase 1: Banco de dados (PRIMEIRO — evita efeito fantasma) ──
  const { error: dbError } = await admin
    .from("videos_library")
    .delete()
    .eq("user_id", user.id)
    .in("id", ids);

  if (dbError) {
    console.error("[library/bulk DELETE] db error:", dbError.message);
    return NextResponse.json({ error: dbError.message }, { status: 500 });
  }

  // ── Fase 2: Storage (DEPOIS — best-effort, não bloqueia resposta) ──
  // P1 CORREÇÃO: Verificar referências antes de apagar fisicamente.
  // PROBLEMA ANTERIOR: O código apagava arquivos do Storage imediatamente após
  // deletar os registros do banco, sem verificar se outras linhas ainda
  // referenciavam o mesmo storage_path. Isso causava perda de dados quando
  // múltiplos registros compartilhavam o mesmo arquivo (ex: clones, reuploads).
  //
  // SOLUÇÃO: Para cada storage_path, consultar se ainda existem registros
  // ativos no banco. Só remover fisicamente se count === 0.
  // "direct/" = URL externa sem upload no Storage → pular
  const storagePaths = ownedRows
    .map(r => r.storage_path)
    .filter(p => p && !p.startsWith("direct/"));

  if (storagePaths.length > 0) {
    // Verifica quais paths ainda têm referências ativas
    const pathsToDelete: string[] = [];
    for (const path of storagePaths) {
      const { count, error: countErr } = await admin
        .from("videos_library")
        .select("id", { count: "exact", head: true })
        .eq("storage_path", path);

      if (countErr) {
        console.error(`[library/bulk DELETE] falha ao contar referências para ${path}:`, countErr.message);
        continue; // Não apaga em caso de erro de consulta
      }

      if ((count ?? 0) === 0) {
        pathsToDelete.push(path);
      } else {
        console.log(`[library/bulk DELETE] ${path} ainda tem ${count} referência(s) — preservado.`);
      }
    }

    if (pathsToDelete.length > 0) {
      // Divide em lotes de 100 (limite da Storage API) e remove em paralelo
      const BATCH_SIZE = 100;
      const batches: string[][] = [];
      for (let i = 0; i < pathsToDelete.length; i += BATCH_SIZE) {
        batches.push(pathsToDelete.slice(i, i + BATCH_SIZE));
      }

      try {
        await Promise.all(
          batches.map(batch =>
            admin.storage
              .from("videos-library")
              .remove(batch)
              .then(({ error }) => {
                if (error && !error.message.toLowerCase().includes("not found")) {
                  console.error("[library/bulk DELETE] storage batch error:", error.message);
                }
              })
              .catch(err => {
                console.error("[library/bulk DELETE] storage batch threw:", err);
              })
          )
        );
      } catch (err) {
        // Nunca deve chegar aqui (cada promise já captura o próprio erro),
        // mas por segurança não deixamos vazar para fora.
        console.error("[library/bulk DELETE] storage cleanup unexpected error:", err);
      }
    }
  }

  return NextResponse.json({ success: true, deleted: ids.length });
}
