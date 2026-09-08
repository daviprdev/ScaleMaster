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

  console.log("\n== 3. Exclusão de pasta apaga TUDO (reversão 2026-09-08) ==\n");

  const folderRoute = src("app/api/library/folders/[id]/route.ts");
  const libraryPage = src("app/dashboard/library/page.tsx");
  const rpcCascade = src("supabase/library_folder_delete_cascade.sql").toLowerCase();

  check("Rota usa a RPC cascade (não a antiga safe)",
    folderRoute.includes("delete_library_folder_cascade") &&
      !folderRoute.includes("delete_library_folder_safe"));
  check("Rota remove os arquivos do Storage após o banco",
    /storage[\s\S]{0,160}\.remove\(/.test(folderRoute) &&
      folderRoute.indexOf("delete_library_folder_cascade") <
        folderRoute.search(/storage[\s\S]{0,160}\.remove\(/));
  check("RPC apaga vídeos, apaga pasta e devolve storage_paths",
    rpcCascade.includes("delete from videos_library") &&
      rpcCascade.includes("delete from library_folders") &&
      rpcCascade.includes("storage_paths"));
  check("Loops da pasta são pausados com motivo legível (dentro da RPC)",
    rpcCascade.includes("status = 'paused'") && rpcCascade.includes("paused_reason"));
  check("Ownership verificado antes de excluir",
    folderRoute.includes('.eq("user_id", user.id)') || folderRoute.includes("p_user_id"));
  check("Duplo-clique bloqueado no frontend",
    libraryPage.includes("if (deletingFolderLoading) return;"));
  check("Erro real aparece na UI (não só no console)",
    libraryPage.includes("deleteFolderError") && libraryPage.includes("{deleteFolderError}"));
  check("Frontend usa try/finally (loading nunca fica preso)",
    /handleDeleteFolder[\s\S]{0,2200}finally \{[\s\S]{0,120}setDeletingFolderLoading\(false\)/.test(libraryPage));
  check("Modal avisa que os vídeos SERÃO apagados de vez",
    libraryPage.includes("Todos os vídeos desta pasta serão apagados"));

  // A limpeza de registros quebrados e de arquivos orfaos do Storage tem suite
  // propria e mais completa: scripts/test-library-integrity.mjs.

  console.log(`\n${passed} passaram, ${failed} falharam\n`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
