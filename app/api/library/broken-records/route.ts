import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { isBrokenRecord } from "@/lib/library-integrity";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * POST /api/library/broken-records
 *
 * Remove APENAS registros quebrados: linhas de `videos_library` cujo arquivo
 * não existe mais no Storage. Nenhum arquivo é apagado por esta rota.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Comportamento anterior (removido em 2026-09-06) — era destrutivo e ambiguo:
 *
 *   const orphans = allVideos.filter(v => v.folder_id === null || …)
 *   await admin.storage.from("videos-library").remove(storagePaths)  // 1º
 *   await admin.from("videos_library").delete().in("id", orphanIds)  // 2º
 *
 * "Órfão" estava definido como `folder_id === null`, isto é, TODO vídeo em
 * "Sem pasta" — que é um estado perfeitamente legítimo. Desde que a exclusão
 * de pasta passou a mover os vídeos para "Sem pasta" em vez de apagá-los, este
 * botão passou a ser exatamente o oposto dessa garantia: excluir a pasta
 * preservava os vídeos e um clique aqui os destruía.
 *
 * Pior: apagava o Storage ANTES do banco (o projeto já documentou a regra
 * inversa) e não tinha `maxDuration`. Com um volume grande, a função morria no
 * meio — arquivos já apagados, linhas ainda no banco. É o estado encontrado em
 * produção nesta auditoria: 961 linhas apontando para arquivos inexistentes.
 *
 * A rota agora só conserta esse estado; ela não pode causá-lo.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export async function POST(_: NextRequest) {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
    return NextResponse.json({ deleted: 0, message: "Supabase não configurado." });
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  const admin = getSupabaseAdmin();

  type VideoRow = { id: string; storage_path: string | null };

  // O PostgREST corta qualquer resposta em 1000 linhas — paginar é obrigatório.
  const videos: VideoRow[] = [];
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await admin
      .from("videos_library")
      .select("id, storage_path")
      .eq("user_id", user.id)
      .range(from, from + PAGE - 1);

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    const page = (data ?? []) as VideoRow[];
    videos.push(...page);
    if (page.length < PAGE) break;
  }

  // Linhas sem arquivo próprio no bucket (URL externa) nunca são candidatas.
  const candidates = videos.filter(
    v => !!v.storage_path && !v.storage_path.startsWith("direct/")
  );
  if (candidates.length === 0) {
    return NextResponse.json({ deleted: 0, message: "Nenhum registro quebrado." });
  }

  // Inventário do que existe de fato no Storage, por prefixo.
  const prefixes = new Set(candidates.map(v => v.storage_path!.split("/")[0]));
  const existing = new Set<string>();

  for (const prefix of prefixes) {
    for (let offset = 0; ; offset += PAGE) {
      const { data, error } = await admin.storage
        .from("videos-library")
        .list(prefix, { limit: PAGE, offset });

      if (error) {
        // Sem inventário confiável, apagar seria um chute — aborta sem mutação.
        console.error("[library-cleanup] falha ao listar Storage:", error.message);
        return NextResponse.json(
          { error: "Não foi possível ler o Storage para verificar os arquivos. Nada foi alterado." },
          { status: 502 }
        );
      }

      const page = data ?? [];
      for (const obj of page) existing.add(`${prefix}/${obj.name}`);
      if (page.length < PAGE) break;
    }
  }

  // Definição canônica em lib/library-integrity.ts — folder_id NUNCA entra aqui.
  const broken = candidates.filter(v => isBrokenRecord(v, existing));
  if (broken.length === 0) {
    return NextResponse.json({ deleted: 0, message: "Nenhum registro quebrado." });
  }

  // Só o banco. O Storage não é tocado em nenhuma hipótese por esta rota.
  const ids = broken.map(v => v.id);
  for (let i = 0; i < ids.length; i += 500) {
    const { error } = await admin
      .from("videos_library")
      .delete()
      .in("id", ids.slice(i, i + 500));
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }

  console.log(
    `[library-cleanup] broken_db_rows=${broken.length} ` +
    `storage_objects_preserved=${existing.size} storage_objects_removed=0`
  );

  return NextResponse.json({
    deleted: broken.length,
    message: `${broken.length} registro(s) sem arquivo removido(s). Nenhum arquivo foi apagado.`,
  });
}
