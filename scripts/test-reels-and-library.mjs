/**
 * Testes das três alterações de 2026-09-06:
 *   1. share_to_feed (Reels + grade / Somente Reels)
 *   2. remoção do módulo Automatizar
 *   3. exclusão segura de pasta da Biblioteca
 *
 * Roda com:  node scripts/test-reels-and-library.mjs
 *
 * Os testes de payload são COMPORTAMENTAIS: interceptam o fetch do undici e
 * inspecionam o corpo real enviado ao endpoint /media da Meta.
 */

import fs from "fs";
import path from "path";
import { spawn } from "child_process";
import { pathToFileURL, fileURLToPath } from "url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let passed = 0;
let failed = 0;

function check(name, ok, detail = "") {
  if (ok) { passed++; console.log(`  PASS  ${name}`); }
  else { failed++; console.log(`  FAIL  ${name}${detail ? ` -- ${detail}` : ""}`); }
}

function src(rel) {
  return fs.readFileSync(path.join(repoRoot, rel), "utf8");
}

function exists(rel) {
  return fs.existsSync(path.join(repoRoot, rel));
}

function run(bin, args) {
  return new Promise((resolve, reject) => {
    const p = spawn(bin, args, { stdio: "ignore", shell: process.platform === "win32" });
    p.on("close", (c) => (c === 0 ? resolve() : reject(new Error(`${bin} exit ${c}`))));
    p.on("error", reject);
  });
}

/**
 * Compila lib/meta-publish.ts com um stub de undici, para capturar o corpo real
 * do POST /media sem tocar na rede.
 */
async function loadMetaPublish() {
  const buildDir = path.join(repoRoot, "node_modules", ".cache", "asc-reels-test");
  fs.rmSync(buildDir, { recursive: true, force: true });
  fs.mkdirSync(buildDir, { recursive: true });

  const tsconfigPath = path.join(buildDir, "tsconfig.test.json");
  fs.writeFileSync(tsconfigPath, JSON.stringify({
    compilerOptions: {
      target: "es2022", module: "es2022", moduleResolution: "node",
      outDir: buildDir, rootDir: repoRoot, skipLibCheck: true, noEmitOnError: false,
    },
    // reel-captions entra junto: meta-publish importa dela a validacao que
    // barra legenda fora dos limites antes de montar o payload.
    files: [
      path.join(repoRoot, "lib/meta-publish.ts"),
      path.join(repoRoot, "lib/reel-captions.ts"),
    ],
  }));
  await run("npx", ["tsc", "-p", tsconfigPath]).catch(() => {});
  fs.writeFileSync(path.join(buildDir, "package.json"), JSON.stringify({ type: "module" }));

  const outFile = path.join(buildDir, "lib", "meta-publish.js");
  if (!fs.existsSync(outFile)) throw new Error("falha ao compilar lib/meta-publish.ts");

  // Stub do undici: registra a chamada e devolve um container fake.
  const calls = [];
  const stubPath = path.join(buildDir, "lib", "undici-stub.js");
  fs.writeFileSync(stubPath, `
export const __calls = [];
export async function fetch(url, init) {
  __calls.push({ url: String(url), body: init?.body ?? "" });
  return {
    ok: true,
    status: 200,
    text: async () => JSON.stringify({ id: "container_fake_1" }),
    json: async () => ({ id: "container_fake_1", status_code: "FINISHED" }),
    headers: { get: () => null },
  };
}
`);
  const js = fs.readFileSync(outFile, "utf8")
    .replace(/from ["']undici["']/g, 'from "./undici-stub.js"')
    // O tsc emite `from "./reel-captions"` sem extensao; o loader ESM do Node
    // exige o `.js`. So o build de teste precisa disso.
    .replace(/from "(\.\/[^"]+?)"/g, (m, p) => (p.endsWith(".js") ? m : `from "${p}.js"`));
  fs.writeFileSync(outFile, js);

  const mod = await import(pathToFileURL(outFile).href);
  const stub = await import(pathToFileURL(stubPath).href);
  return { mod, calls: stub.__calls, buildDir };
}

function parseForm(body) {
  const out = {};
  for (const pair of String(body).split("&")) {
    const i = pair.indexOf("=");
    if (i === -1) continue;
    out[pair.slice(0, i)] = decodeURIComponent(pair.slice(i + 1));
  }
  return out;
}

async function main() {
  console.log("\n== 1. share_to_feed: payload real enviado à Meta ==\n");

  const { mod, calls, buildDir } = await loadMetaPublish();

  // TESTE 1 — Reels + grade
  calls.length = 0;
  await mod.createMediaContainerOnly("178414", "https://x.test/v.mp4", "legenda", "TOKEN", "REELS", true);
  let form = parseForm(calls[0].body);
  check("TESTE 1: Reels + grade envia media_type=REELS e share_to_feed=true",
    form.media_type === "REELS" && form.share_to_feed === "true");

  // TESTE 2 — Somente Reels
  calls.length = 0;
  await mod.createMediaContainerOnly("178414", "https://x.test/v.mp4", "legenda", "TOKEN", "REELS", false);
  form = parseForm(calls[0].body);
  check("TESTE 2: Somente Reels envia media_type=REELS e share_to_feed=false",
    form.media_type === "REELS" && form.share_to_feed === "false");

  // TESTE 3 — false não pode sumir do payload
  check("TESTE 3: o valor false NÃO desaparece do corpo da requisição",
    calls[0].body.includes("share_to_feed=false"));
  check("TESTE 3: o código usa typeof boolean (não um if truthy)",
    /typeof shareToFeed === "boolean"/.test(src("lib/meta-publish.ts")));

  // TESTE 4 — Story nunca leva share_to_feed
  calls.length = 0;
  await mod.createMediaContainerOnly("178414", "https://x.test/img.jpg", "", "TOKEN", "STORIES", true);
  form = parseForm(calls[0].body);
  check("TESTE 4: STORIES não envia share_to_feed (mesmo forçando true)",
    form.media_type === "STORIES" && !("share_to_feed" in form));
  check("TESTE 4: STORIES de imagem usa image_url", "image_url" in form);

  // Sem escolha persistida (null) → parâmetro omitido (comportamento anterior)
  calls.length = 0;
  await mod.createMediaContainerOnly("178414", "https://x.test/v.mp4", "c", "TOKEN", "REELS", null);
  form = parseForm(calls[0].body);
  check("NULL mantém o comportamento anterior: parâmetro não é enviado",
    form.media_type === "REELS" && !("share_to_feed" in form));

  // publishViaMetaAPI (publicação imediata da aba Postar)
  calls.length = 0;
  await mod.publishViaMetaAPI("178414", "TOKEN", "https://x.test/v.mp4", "c", false);
  form = parseForm(calls[0].body);
  check("TESTE 7: publicação imediata (Postar) respeita a escolha",
    form.media_type === "REELS" && form.share_to_feed === "false");

  fs.rmSync(buildDir, { recursive: true, force: true });

  console.log("\n== 1b. Propagação e snapshot da escolha ==\n");

  const loops = src("app/api/cron/process-loops/route.ts");
  const publishScheduled = src("app/api/cron/publish-scheduled/route.ts");
  const distribute = src("app/api/posts/distribute/route.ts");
  const clone = src("app/api/clone/create/route.ts");
  const syncDistribute = src("app/api/cron/sync-distribute-accounts/route.ts");

  check("TESTE 5: Loop grava o valor usado no pending_container (snapshot)",
    loops.includes("share_to_feed: shareToFeed") && loops.includes("loop.share_to_feed"));
  check("TESTE 5: publish-scheduled lê a escolha DO POST, nunca da configuração",
    publishScheduled.includes("post.share_to_feed") &&
      !publishScheduled.includes('from("loops")') &&
      !publishScheduled.includes('from("distribute_campaigns")'));
  check("TESTE 6: Clone persiste a escolha em cada post agendado",
    clone.includes("share_to_feed:") && clone.includes('typeof body.share_to_feed === "boolean"'));
  check("TESTE 7: Postar persiste a escolha no post e na campanha sincronizada",
    (distribute.match(/share_to_feed/g) ?? []).length >= 3);
  check("Campanha sincronizada copia a escolha para contas novas",
    syncDistribute.includes("share_to_feed:"));
  check("Nenhum fluxo de Stories envia share_to_feed",
    !src("app/api/cron/story-templates/route.ts").includes("share_to_feed") &&
      !src("app/api/posts/stories/post-now/route.ts").includes("share_to_feed"));
  check("UI existe nas 3 telas ativas (Postar, Loop, Clonar)",
    src("app/dashboard/postar/page.tsx").includes("ReelPlacementSelector") &&
      src("app/dashboard/loop/page.tsx").includes("ReelPlacementSelector") &&
      src("app/dashboard/clone/page.tsx").includes("ReelPlacementSelector"));
  check("Log [meta-reel] antes da criação do container, sem token",
    /\[meta-reel\] share_to_feed=/.test(src("lib/meta-publish.ts")));

  console.log("\n== 2. Módulo Automatizar removido do produto ativo ==\n");

  check("rota /api/automations removida", !exists("app/api/automations"));
  check("cron process-automations removido", !exists("app/api/cron/process-automations"));
  check("schedule do cron fora do vercel.json",
    !src("vercel.json").includes("process-automations"));
  check("Sidebar sem o item Automatizar",
    !src("components/dashboard/Sidebar.tsx").includes("/dashboard/automatizar"));
  check("Dashboard sem a ação rápida Automatizar",
    !src("app/dashboard/page.tsx").includes("/dashboard/automatizar"));
  check("Header sem o título da página removida",
    !src("components/dashboard/Header.tsx").includes("/dashboard/automatizar"));
  check("URL antiga redireciona para /dashboard/postar",
    src("app/dashboard/automatizar/page.tsx").includes('redirect("/dashboard/postar")'));
  check("Nenhum caller de /api/automations sobrou no front", (() => {
    const dirs = ["app/dashboard", "components"];
    for (const d of dirs) {
      const stack = [path.join(repoRoot, d)];
      while (stack.length) {
        const cur = stack.pop();
        for (const e of fs.readdirSync(cur, { withFileTypes: true })) {
          const fp = path.join(cur, e.name);
          if (e.isDirectory()) stack.push(fp);
          else if (e.name.endsWith(".tsx") && fs.readFileSync(fp, "utf8").includes("/api/automations")) return false;
        }
      }
    }
    return true;
  })());

  console.log("\n== 3. Exclusão segura de pasta da Biblioteca ==\n");

  const folderRoute = src("app/api/library/folders/[id]/route.ts");
  const libraryPage = src("app/dashboard/library/page.tsx");

  check("TESTE 2 (pasta cheia): a rota NÃO apaga vídeos do banco",
    !/from\("videos_library"\)[\s\S]{0,200}\.delete\(\)/.test(folderRoute));
  check("TESTE 2: a rota NÃO apaga arquivos do Storage",
    !folderRoute.includes("storage") || !folderRoute.includes(".remove("));
  // A contagem passou a acontecer dentro da RPC transacional (select count(*)),
  // não mais na rota — o objetivo (não trafegar as linhas) continua garantido.
  check("Contagem de vídeos é feita no banco, sem trazer as linhas",
    src("supabase/library_folder_delete_fix.sql").includes("select count(*) into v_videos"));
  check("TESTE 3: Loops da pasta são pausados com motivo legível (dentro da RPC)",
    src("supabase/library_folder_delete_fix.sql").includes("status = 'paused'") &&
      src("supabase/library_folder_delete_fix.sql").includes("paused_reason"));
  check("TESTE 5: ownership verificado antes de excluir",
    folderRoute.includes('.eq("user_id", user.id)') && folderRoute.includes("Pasta não encontrada"));
  check("TESTE 6: duplo-clique bloqueado no frontend",
    libraryPage.includes("if (deletingFolderLoading) return;"));
  check("TESTE 7: erro real aparece na UI (não só no console)",
    libraryPage.includes("deleteFolderError") && libraryPage.includes("{deleteFolderError}"));
  check("Frontend usa try/finally (loading nunca fica preso)",
    /handleDeleteFolder[\s\S]{0,2200}finally \{[\s\S]{0,120}setDeletingFolderLoading\(false\)/.test(libraryPage));
  check("Modal explica que os vídeos NÃO serão excluídos",
    libraryPage.includes("não excluirá os vídeos"));
  check("Migration da pasta não altera FK, não apaga vídeos nem toca no Storage",
    (() => {
      const sql = src("supabase/library_folder_delete_fix.sql").toLowerCase();
      const semComentarios = sql
        .split(/\r?\n/)
        .filter((l) => !l.trim().startsWith("--"))
        .join("\n");
      return sql.includes("add column if not exists paused_reason")
        // o único DELETE permitido é o da própria pasta
        && !semComentarios.includes("delete from videos_library")
        && !semComentarios.includes("storage")
        && !/alter table[\s\S]*?(drop constraint|add constraint)[\s\S]*?fkey/.test(semComentarios)
        && !semComentarios.includes("drop table");
    })());

  // A limpeza de registros quebrados e de arquivos orfaos do Storage tem suite
  // propria e mais completa: scripts/test-library-integrity.mjs.

  console.log(`\n${passed} passaram, ${failed} falharam\n`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
