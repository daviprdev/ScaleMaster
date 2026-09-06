import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { isOrphanFile, ORPHAN_GRACE_MS } from "@/lib/library-integrity";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 120;

/**
 * Limpeza de ARQUIVOS ÓRFÃOS do Storage — operação de administrador.
 *
 * As quatro operações da Biblioteca são distintas e não se misturam:
 *   1. Excluir pasta          → só a pasta. Vídeos vão para "Sem pasta".
 *   2. Excluir vídeo          → banco + arquivo, sob pedido explícito do dono.
 *   3. Limpar registro quebrado → linha existe, arquivo não. Remove SÓ o banco.
 *   4. Limpar arquivo órfão   → arquivo existe, nenhuma referência. Remove SÓ o
 *                               Storage. É esta rota, e é admin-only.
 *
 * Fica restrita a admin de propósito: apagar bytes é irreversível e não deve
 * ficar a um clique de distância do usuário comum. Também não roda em cron —
 * decisão explícita de manter a limpeza física manual enquanto o sistema
 * estabiliza, para nunca existir um "todo dia apaga o que parecer órfão".
 *
 * GET  → auditoria, não muta nada.
 * POST → apaga os órfãos confirmados.
 */

const BUCKET = "videos-library";
const GRACE_MS = ORPHAN_GRACE_MS;

/** Prefixos varridos. `temp/` tem limpeza própria no cron process-videos. */
const PREFIXOS = ["videos", "stories", "variants/clean/v1"];

type Alvo = { name: string; size: number };

async function exigirAdmin() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { erro: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };

  const { data: roleData } = await supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", user.id)
    .single();

  if (roleData?.role !== "admin") {
    return { erro: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }
  return { erro: null };
}

/**
 * Reúne TODA referência a mídia existente no banco. É deliberadamente
 * abrangente: um arquivo só é órfão se não aparecer em nenhuma destas colunas.
 * Colunas de URL guardam a URL pública inteira, então comparamos por sufixo.
 */
async function coletarReferencias(admin: ReturnType<typeof getSupabaseAdmin>) {
  const refs = new Set<string>();
  const PAGE = 1000;

  const fontes: { tabela: string; colunas: string[] }[] = [
    { tabela: "videos_library", colunas: ["storage_path", "public_url", "original_url"] },
    { tabela: "video_variants", colunas: ["storage_path", "public_url", "source_url"] },
    { tabela: "scheduled_posts", colunas: ["video_url"] },
    { tabela: "pending_containers", colunas: [] },
    { tabela: "story_media", colunas: ["storage_path", "public_url"] },
    { tabela: "story_templates", colunas: ["media_url"] },
    { tabela: "single_posts", colunas: ["media_url"] },
    { tabela: "video_processing_jobs", colunas: ["source_url", "output_url"] },
    { tabela: "loops", colunas: ["cover_image_url"] },
  ];

  for (const { tabela, colunas } of fontes) {
    if (colunas.length === 0) continue;
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await admin
        .from(tabela)
        .select(colunas.join(","))
        .range(from, from + PAGE - 1);

      // Sem leitura confiável de uma fonte, abortamos: apagar seria um chute.
      if (error) throw new Error(`falha ao ler referências de ${tabela}: ${error.message}`);

      const linhas = (data ?? []) as unknown as Record<string, string | null>[];
      for (const linha of linhas) {
        for (const col of colunas) {
          const valor = linha[col];
          if (valor) refs.add(valor);
        }
      }
      if (linhas.length < PAGE) break;
    }
  }
  return refs;
}

async function levantarOrfaos(admin: ReturnType<typeof getSupabaseAdmin>) {
  const refs = await coletarReferencias(admin);
  const agora = Date.now();
  const orfaos: Alvo[] = [];
  let inspecionados = 0;
  let dentroDoGrace = 0;

  for (const prefixo of PREFIXOS) {
    const PAGE = 100;
    for (let offset = 0; ; offset += PAGE) {
      const { data, error } = await admin.storage
        .from(BUCKET)
        .list(prefixo, { limit: PAGE, offset, sortBy: { column: "name", order: "asc" } });

      if (error) throw new Error(`falha ao listar ${prefixo}: ${error.message}`);
      const page = data ?? [];

      for (const obj of page) {
        // `list` devolve "pastas" como itens sem id — ignorar.
        if (!obj.id) continue;
        inspecionados++;
        const nome = `${prefixo}/${obj.name}`;

        // Definição canônica em lib/library-integrity.ts: sem referência E
        // fora do grace period. folder_id nunca participa.
        if (!isOrphanFile(nome, refs, obj.created_at ?? 0, agora, GRACE_MS)) {
          const criadoEm = new Date(obj.created_at ?? 0).getTime();
          if (agora - criadoEm <= GRACE_MS) dentroDoGrace++;
          continue;
        }

        orfaos.push({
          name: nome,
          size: Number((obj.metadata as { size?: number } | null)?.size ?? 0),
        });
      }
      if (page.length < PAGE) break;
    }
  }

  return { orfaos, inspecionados, dentroDoGrace, referencias: refs.size };
}

export async function GET() {
  const { erro } = await exigirAdmin();
  if (erro) return erro;

  try {
    const r = await levantarOrfaos(getSupabaseAdmin());
    return NextResponse.json({
      inspecionados: r.inspecionados,
      referencias_no_banco: r.referencias,
      protegidos_pelo_grace: r.dentroDoGrace,
      orfaos: r.orfaos.length,
      bytes: r.orfaos.reduce((s, o) => s + o.size, 0),
      amostra: r.orfaos.slice(0, 10).map(o => o.name),
    });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}

export async function POST(_: NextRequest) {
  const { erro } = await exigirAdmin();
  if (erro) return erro;

  const admin = getSupabaseAdmin();

  let alvos: Alvo[];
  try {
    alvos = (await levantarOrfaos(admin)).orfaos;
  } catch (e) {
    return NextResponse.json(
      { error: `${(e as Error).message} — nada foi apagado.` },
      { status: 502 }
    );
  }

  if (alvos.length === 0) {
    return NextResponse.json({ removed: 0, bytes: 0, message: "Nenhum arquivo órfão." });
  }

  const BATCH = 50;
  let removed = 0;
  let bytes = 0;

  for (let i = 0; i < alvos.length; i += BATCH) {
    const lote = alvos.slice(i, i + BATCH);
    const { error } = await admin.storage.from(BUCKET).remove(lote.map(a => a.name));
    if (error) {
      console.error(`[library-cleanup] lote ${i / BATCH + 1} falhou:`, error.message);
      continue;
    }
    removed += lote.length;
    bytes += lote.reduce((s, a) => s + a.size, 0);
  }

  console.log(
    `[library-cleanup] broken_db_rows=0 orphan_storage_objects=${removed} bytes_removed=${bytes}`
  );

  return NextResponse.json({
    removed,
    bytes,
    message: `${removed} arquivo(s) sem uso removido(s) do armazenamento.`,
  });
}
