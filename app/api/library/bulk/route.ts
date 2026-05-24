import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";

export const runtime = "nodejs";

interface BulkDeleteItem {
  id: string;
  storage_path: string;
}

// DELETE /api/library/bulk — hard delete em lote
// Body: { items: Array<{ id: string; storage_path: string }> }
// Etapa 1: remove arquivos físicos do Storage
// Etapa 2: deleta registros do banco
export async function DELETE(req: NextRequest) {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
    return NextResponse.json({ error: "Supabase não configurado." }, { status: 503 });
  }

  const body = await req.json() as { items?: BulkDeleteItem[] };
  const items = body.items;

  if (!Array.isArray(items) || items.length === 0) {
    return NextResponse.json({ error: "'items' deve ser um array não vazio." }, { status: 400 });
  }

  const admin = getSupabaseAdmin();

  // ── Etapa 1: Supabase Storage ──────────────────────────────────
  // "direct/" significa URL externa sem upload no Storage → pular
  const storagePaths = items
    .map(i => i.storage_path)
    .filter(p => p && !p.startsWith("direct/"));

  if (storagePaths.length > 0) {
    // Processar em lotes de 100 (limite da API do Storage)
    const STORAGE_BATCH = 100;
    for (let i = 0; i < storagePaths.length; i += STORAGE_BATCH) {
      const batch = storagePaths.slice(i, i + STORAGE_BATCH);
      const { error: storageErr } = await admin.storage
        .from("videos-library")
        .remove(batch);

      if (storageErr && !storageErr.message.toLowerCase().includes("not found")) {
        console.error(`[library/bulk DELETE] storage batch error: ${storageErr.message}`);
        // Não bloquear: continua para deletar do banco mesmo se Storage falhar
      }
    }
  }

  // ── Etapa 2: Banco de dados ────────────────────────────────────
  const ids = items.map(i => i.id);
  const { error: dbError } = await admin
    .from("videos_library")
    .delete()
    .in("id", ids);

  if (dbError) {
    return NextResponse.json({ error: dbError.message }, { status: 500 });
  }

  return NextResponse.json({ success: true, deleted: ids.length });
}
