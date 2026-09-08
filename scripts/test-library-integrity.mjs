/**
 * Integridade da Biblioteca — testes de regressão.
 *
 * Existe por causa de um estado real de produção: 961 registros apontando para
 * arquivos que não existiam mais. A causa estrutural era a confusão entre as
 * quatro operações da Biblioteca — em especial tratar `folder_id IS NULL`
 * ("Sem pasta", estado válido) como lixo descartável.
 *
 * Os TESTES 1-6 e 10 são COMPORTAMENTAIS: compilam lib/library-integrity.ts e
 * executam as funções de verdade. Os demais são guardas estruturais sobre as
 * rotas e a migration.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { execFileSync } from "node:child_process";
import os from "node:os";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const src = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");

let passed = 0;
let failed = 0;
const check = (nome, ok) => {
  if (ok) { passed++; console.log(`  PASS  ${nome}`); }
  else { failed++; console.log(`  FAIL  ${nome}`); }
};

/** Compila um módulo TS isolado e importa para exercitar de verdade. */
function compilarLib(relPath) {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), "libint-"));
  execFileSync(
    process.platform === "win32" ? "npx.cmd" : "npx",
    ["tsc", path.join(ROOT, relPath), "--outDir", out, "--target", "es2022", "--module", "es2022", "--moduleResolution", "bundler"],
    { stdio: "pipe", shell: process.platform === "win32" }
  );
  return path.join(out, path.basename(relPath).replace(/\.ts$/, ".js"));
}

async function main() {
  console.log("\n== 1. Registro quebrado vs. arquivo órfão (comportamental) ==\n");

  const libPath = compilarLib("lib/library-integrity.ts");
  const { isBrokenRecord, isOrphanFile, ORPHAN_GRACE_MS } =
    await import(pathToFileURL(libPath).href);

  const existentes = new Set(["videos/upload_a.mp4", "videos/upload_b.mp4"]);

  // TESTE 1 — "Sem pasta" com arquivo presente NÃO é quebrado.
  check("TESTE 1: folder_id=NULL + arquivo existe → NÃO é quebrado",
    isBrokenRecord({ storage_path: "videos/upload_a.mp4", folder_id: null }, existentes) === false);

  // TESTE 2 — em pasta, com arquivo presente, também não.
  check("TESTE 2: folder_id=<pasta> + arquivo existe → NÃO é quebrado",
    isBrokenRecord({ storage_path: "videos/upload_b.mp4", folder_id: "uuid-pasta" }, existentes) === false);

  // TESTE 3 — linha sem arquivo é quebrada, esteja em pasta ou não.
  check("TESTE 3: linha existe + arquivo ausente → é quebrado",
    isBrokenRecord({ storage_path: "videos/sumiu.mp4", folder_id: null }, existentes) === true &&
    isBrokenRecord({ storage_path: "videos/sumiu.mp4", folder_id: "uuid-pasta" }, existentes) === true);

  check("folder_id NÃO altera a decisão (mesmo path, pastas diferentes)",
    isBrokenRecord({ storage_path: "videos/upload_a.mp4", folder_id: null }, existentes) ===
    isBrokenRecord({ storage_path: "videos/upload_a.mp4", folder_id: "x" }, existentes));

  check("caminho direct/ (URL externa) nunca é quebrado",
    isBrokenRecord({ storage_path: "direct/https://cdn/x.mp4", folder_id: null }, existentes) === false);

  const agora = Date.now();
  const antigo = agora - ORPHAN_GRACE_MS - 60_000;
  const recente = agora - 60_000;

  // TESTE 4 — sem referência e fora do grace → pode remover.
  check("TESTE 4: arquivo sem referência + fora do grace → é órfão",
    isOrphanFile("videos/stripped_x.mp4", new Set(), antigo, agora) === true);

  // TESTE 5 — referenciado por post na fila → protegido.
  const refPost = new Set([
    "https://proj.supabase.co/storage/v1/object/public/videos-library/videos/usado.mp4",
  ]);
  check("TESTE 5: referenciado por scheduled_posts (via URL pública) → NÃO é órfão",
    isOrphanFile("videos/usado.mp4", refPost, antigo, agora) === false);
  check("TESTE 5b: referenciado por storage_path cru → NÃO é órfão",
    isOrphanFile("videos/usado.mp4", new Set(["videos/usado.mp4"]), antigo, agora) === false);

  // TESTE 6 — recém-criado dentro do grace → protegido (janela upload→INSERT).
  check("TESTE 6: órfão recém-criado dentro do grace period → NÃO remover",
    isOrphanFile("videos/novo.mp4", new Set(), recente, agora) === false);

  check("data de criação inválida → nunca remove",
    isOrphanFile("videos/x.mp4", new Set(), "data-invalida", agora) === false);

  console.log("\n== 2. Excluir pasta apaga TUDO (reversão 2026-09-08) ==\n");

  // Decisão do dono: excluir pasta apaga a pasta E os vídeos (banco + Storage).
  // A RPC vigente é delete_library_folder_cascade; a antiga
  // delete_library_folder_safe (mover para NULL) NÃO é mais usada pela rota.
  const rpc = src("supabase/library_folder_delete_cascade.sql");
  const corpoRpc = rpc
    .split(/\r?\n/)
    .filter((l) => !l.trim().startsWith("--"))
    .join("\n")
    .toLowerCase();

  check("TESTE 7/8: RPC APAGA os vídeos da pasta (videos_library)",
    corpoRpc.includes("delete from videos_library"));
  check("TESTE 7/8: RPC apaga também a própria pasta",
    corpoRpc.includes("delete from library_folders"));
  check("TESTE 7/8: RPC devolve storage_paths para a rota remover os arquivos",
    corpoRpc.includes("storage_paths"));
  check("RPC coleta os paths ANTES de apagar as linhas",
    corpoRpc.indexOf("array_agg(storage_path)") < corpoRpc.indexOf("delete from videos_library"));
  check("RPC exclui direct/ da lista de arquivos (URL externa, sem Storage)",
    corpoRpc.includes("not like 'direct/%'"));
  check("RPC valida ownership antes de qualquer mutação",
    corpoRpc.includes("where id = p_folder_id and user_id = p_user_id"));
  check("Loop dependente é pausado com motivo legível",
    corpoRpc.includes("status = 'paused'") && corpoRpc.includes("paused_reason"));

  const folderRoute = src("app/api/library/folders/[id]/route.ts");
  check("Rota de pasta chama a RPC cascade (não a antiga safe)",
    folderRoute.includes("delete_library_folder_cascade") &&
      !folderRoute.includes("delete_library_folder_safe"));
  check("Rota de pasta remove os arquivos do Storage",
    /storage[\s\S]{0,160}\.remove\(/.test(folderRoute));
  check("Rota remove Storage DEPOIS do banco (RPC roda antes do remove)",
    folderRoute.indexOf("delete_library_folder_cascade") <
      folderRoute.search(/storage[\s\S]{0,160}\.remove\(/));

  console.log("\n== 3. As quatro operações são distintas ==\n");

  const brokenRoute = src("app/api/library/broken-records/route.ts");
  const orphanRoute = src("app/api/admin/storage-orphans/route.ts");
  const videoRoute = src("app/api/library/route.ts");
  const semComentarios = (s) =>
    s.split(/\r?\n/)
      .filter((l) => { const t = l.trim(); return !t.startsWith("*") && !t.startsWith("//") && !t.startsWith("/*"); })
      .join("\n");

  check("C) Limpar registro quebrado NUNCA chama storage.remove",
    !/storage[\s\S]{0,120}\.remove\(/.test(semComentarios(brokenRoute)));
  check("C) rota de registros quebrados é do usuário (não admin-only)",
    brokenRoute.includes("auth.getUser()") && !brokenRoute.includes('roleData?.role !== "admin"'));
  check("C) leitura paginada (teto de 1000 do PostgREST)",
    brokenRoute.includes(".range(from, from + PAGE - 1)"));
  check("C) falha ao listar Storage aborta sem apagar",
    brokenRoute.includes("Nada foi alterado"));

  check("D) Limpar arquivo órfão NUNCA apaga videos_library",
    !/from\("videos_library"\)[\s\S]{0,200}\.delete\(\)/.test(semComentarios(orphanRoute)));
  check("D) limpeza física de Storage é ADMIN-ONLY",
    orphanRoute.includes('roleData?.role !== "admin"') && orphanRoute.includes("Forbidden"));
  check("D) respeita grace period",
    orphanRoute.includes("ORPHAN_GRACE_MS") || orphanRoute.includes("GRACE_MS"));
  check("D) referências derivadas server-side (não vêm do cliente)",
    orphanRoute.includes("coletarReferencias") && !orphanRoute.includes("req.json()"));
  check("D) NÃO existe cron apagando Storage automaticamente",
    !src("vercel.json").includes("storage-orphans"));

  check("Ambas as rotas usam a definição canônica única",
    brokenRoute.includes('from "@/lib/library-integrity"') &&
      orphanRoute.includes('from "@/lib/library-integrity"'));

  // O critério destrutivo antigo não pode reaparecer em nenhuma delas.
  for (const [nome, código] of [["registros quebrados", brokenRoute], ["arquivos órfãos", orphanRoute]]) {
    check(`${nome}: folder_id não é critério de descarte`,
      !/folder_id\s*===\s*null/.test(semComentarios(código)) &&
      !/folder_id.*is.*null/i.test(semComentarios(código).replace(/\/\*[\s\S]*?\*\//g, "")));
  }

  console.log("\n== 4. Excluir vídeo e upload resilientes ==\n");

  // TESTE 9 — exclusão explícita remove os dois, na ordem segura.
  const mDb = /\.from\("videos_library"\)\s*\r?\n\s*\.delete\(\)/.exec(videoRoute);
  const mStorage = /\.remove\(\[path\]\)/.exec(videoRoute);
  check("TESTE 9: excluir vídeo remove banco E arquivo",
    mDb !== null && mStorage !== null);
  check("TESTE 9: banco PRIMEIRO, Storage depois (falha deixa órfão, não quebrado)",
    mDb !== null && mStorage !== null && mDb.index < mStorage.index);
  check("TESTE 9: storage_path derivado da linha do dono, não do corpo da requisição",
    videoRoute.includes('.select("id, storage_path")') &&
      !/const \{ id, storage_path \} = await req\.json/.test(videoRoute));

  // TESTE 10 — compensação de upload.
  const recordRoute = src("app/api/library/record/route.ts");
  check("TESTE 10: INSERT falhou → compensa removendo o arquivo recém-enviado",
    /if \(error\)[\s\S]{0,800}storage[\s\S]{0,200}\.remove\(\[storagePath\]\)/.test(recordRoute));
  check("TESTE 10: compensação só se nenhuma linha referenciar o arquivo",
    /count: "exact", head: true[\s\S]{0,200}\.eq\("storage_path", storagePath\)/.test(recordRoute));
  check("TESTE 10: compensação nunca é limpeza global",
    !/\.remove\(\s*paths/.test(recordRoute) && recordRoute.includes(".remove([storagePath])"));

  console.log("\n== 5. Observabilidade e UI ==\n");

  check("log [library-cleanup] com broken_db_rows",
    brokenRoute.includes("[library-cleanup] broken_db_rows="));
  check("log [library-cleanup] com orphan_storage_objects e bytes_removed",
    orphanRoute.includes("orphan_storage_objects=") && orphanRoute.includes("bytes_removed="));
  check("logs não expõem token nem URL assinada",
    !/access_token|service_role|Bearer \$\{/.test(brokenRoute + orphanRoute));

  const libraryPage = src("app/dashboard/library/page.tsx");
  check("UI não usa mais o nome ambíguo 'Limpar Órfãos'",
    !libraryPage.includes("Limpar Órfãos"));
  check("UI nomeia a operação com clareza",
    libraryPage.includes("Limpar Registros Quebrados"));
  check("UI descreve o efeito real",
    libraryPage.includes("cujo arquivo já não existe no armazenamento"));
  check("Operação destrutiva exige 2 cliques",
    libraryPage.includes("confirmCleanup") && libraryPage.includes('"Confirmar?"'));
  check("Modal de pasta avisa que os vídeos SERÃO apagados de vez",
    libraryPage.includes("Todos os vídeos desta pasta serão apagados"));

  console.log(`\n${passed} passaram, ${failed} falharam\n`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
