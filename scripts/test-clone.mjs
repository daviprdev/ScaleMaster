/**
 * Testes da aba "Clonar Perfil" (2026-09-20).
 *
 * TESTE 1-4 são COMPORTAMENTAIS: compilam lib/clone-media.ts e executam as
 * duas decisões que quebraram o Clone em produção (ordem/dedup da fila e poda
 * por referência). O resto são invariantes estáticas que amarram as regras no
 * lugar — cada uma corresponde a um bug real encontrado nesta auditoria.
 *
 * Roda com:  node scripts/test-clone.mjs
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

const src = (rel) => fs.readFileSync(path.join(repoRoot, rel), "utf8");

/** Remove comentários para que uma regra "não pode existir" não seja satisfeita
 *  por um comentário que só fala sobre ela. */
function stripComments(code) {
  return code.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

function run(bin, args) {
  return new Promise((resolve, reject) => {
    const p = spawn(bin, args, { stdio: "ignore", shell: process.platform === "win32" });
    p.on("close", (c) => (c === 0 ? resolve() : reject(new Error(`${bin} exit ${c}`))));
    p.on("error", reject);
  });
}

async function compile(files, cacheName) {
  const buildDir = path.join(repoRoot, "node_modules", ".cache", cacheName);
  fs.rmSync(buildDir, { recursive: true, force: true });
  fs.mkdirSync(buildDir, { recursive: true });
  const tsconfigPath = path.join(buildDir, "tsconfig.test.json");
  fs.writeFileSync(tsconfigPath, JSON.stringify({
    compilerOptions: {
      target: "es2022", module: "es2022", moduleResolution: "node",
      outDir: buildDir, rootDir: repoRoot, skipLibCheck: true, noEmitOnError: false,
      baseUrl: repoRoot, paths: { "@/*": ["./*"] },
    },
    files: files.map((f) => path.join(repoRoot, f)),
  }));
  await run("npx", ["tsc", "-p", tsconfigPath]).catch(() => {});
  fs.writeFileSync(path.join(buildDir, "package.json"), JSON.stringify({ type: "module" }));
  return buildDir;
}

const PREFETCH = "app/api/cron/prefetch-clone-urls/route.ts";
const CREATE = "app/api/clone/create/route.ts";
const SEARCH = "app/api/clone/search/route.ts";
const POLL = "app/api/clone/search/poll/route.ts";
const PAGE = "app/dashboard/clone/page.tsx";
const LOOPS = "app/api/cron/process-loops/route.ts";

async function main() {
  console.log("\n== 1. Fila do prefetch: urgência preservada, dedup depois ==\n");

  const buildDir = await compile(["lib/clone-media.ts"], "asc-clone");
  const lib = await import(pathToFileURL(path.join(buildDir, "lib", "clone-media.js")).href);

  const A = "https://www.instagram.com/reel/AAA/";
  const B = "https://www.instagram.com/reel/BBB/";
  const C = "https://www.instagram.com/reel/CCC/";

  // 3 contas postam o Reel A primeiro, depois B, depois C. Era exatamente
  // este formato que o código antigo truncava antes de deduplicar.
  const fila = [
    { video_url: A }, { video_url: A }, { video_url: A },
    { video_url: B }, { video_url: B }, { video_url: B },
    { video_url: C },
  ];
  const urls = lib.dedupeQueueByUrl(fila);
  check("3 Reels distintos saem de 7 linhas", urls.length === 3, JSON.stringify(urls));
  check("a ordem é a de publicação (A, B, C)", urls[0] === A && urls[1] === B && urls[2] === C);

  check("linha sem URL é ignorada sem quebrar",
    lib.dedupeQueueByUrl([{ video_url: null }, { video_url: A }, {}]).length === 1);

  console.log("\n== 2. shortCode e caminho no Storage ==\n");

  check("permalink /reel/ → shortCode", lib.shortCodeFromUrl(A) === "AAA");
  check("permalink /p/ também é aceito",
    lib.shortCodeFromUrl("https://www.instagram.com/p/DXy_-1z/") === "DXy_-1z");
  check("URL sem shortCode devolve null",
    lib.shortCodeFromUrl("https://www.instagram.com/perfil/") === null);
  check("o arquivo é chaveado pelo REEL, não pelo post",
    lib.storagePathFor("AAA") === "clone/AAA.mp4");
  check("nome do arquivo volta da URL pública",
    lib.fileNameFromHostedUrl("https://x.supabase.co/storage/v1/object/public/videos-library/clone/AAA.mp4") === "AAA.mp4");

  console.log("\n== 3. Poda: referência manda mais que idade ==\n");

  const hora = 60 * 60_000;
  const agora = Date.now();
  const cutoff = agora - 24 * hora;
  const files = [
    { name: "AAA.mp4", created_at: new Date(agora - 72 * hora).toISOString() }, // velho, EM USO
    { name: "BBB.mp4", created_at: new Date(agora - 72 * hora).toISOString() }, // velho, órfão
    { name: "CCC.mp4", created_at: new Date(agora - 1 * hora).toISOString() },  // novo, órfão
    { name: "DDD.mp4", created_at: null },                                      // sem data
  ];
  const refs = ["https://x.supabase.co/storage/v1/object/public/videos-library/clone/AAA.mp4"];
  const alvos = lib.selectPruneTargets(files, refs, cutoff);

  check("arquivo velho MAS referenciado por post pendente NÃO é apagado",
    !alvos.includes("clone/AAA.mp4"), JSON.stringify(alvos));
  check("arquivo velho e sem referência é apagado", alvos.includes("clone/BBB.mp4"));
  check("arquivo recente e sem referência ainda não é apagado (período de graça)",
    !alvos.includes("clone/CCC.mp4"));
  check("arquivo sem data conhecida não é apagado", !alvos.includes("clone/DDD.mp4"));
  check("só esses alvos", alvos.length === 1);

  // A regressão exata de produção: campanha de 3 dias, mídia com mais de 2h.
  const campanhaLonga = lib.selectPruneTargets(
    [{ name: "ZZZ.mp4", created_at: new Date(agora - 48 * hora).toISOString() }],
    ["https://x.supabase.co/storage/v1/object/public/videos-library/clone/ZZZ.mp4"],
    cutoff
  );
  check("REGRESSÃO 2026-09-20: mídia de campanha em andamento sobrevive à poda",
    campanhaLonga.length === 0);

  console.log("\n== 4. O prefetch não volta a usar temp/ nem o marcador em error_message ==\n");

  const prefetch = stripComments(src(PREFETCH));
  check("nenhum arquivo de clone vai para temp/ (limpo por IDADE em 2h)",
    !/["'`]temp\//.test(prefetch) && !/temp\/clone_/.test(prefetch));
  check("o prefixo usado é clone/ da lib", prefetch.includes('from "@/lib/clone-media"'));
  check("o run da Apify não é mais rastreado em error_message",
    !prefetch.includes("APIFY_RUN"));
  check("existe teto de tentativas por Reel", /MAX_ATTEMPTS/.test(prefetch));
  check("Reel que estourou o teto vira 'error' e não gasta run de novo",
    /status === "error"\)\s*continue/.test(prefetch) || /media\.status === "error"/.test(prefetch));
  check("posts sem mídia possível falham com motivo (não ficam pending para sempre)",
    prefetch.includes("[CLONE] Não foi possível obter o vídeo"));
  check("a fila é lida ORDENADA por scheduled_at",
    /\.order\("scheduled_at", \{ ascending: true \}\)/.test(prefetch));
  // lastIndexOf: a primeira ocorrência de dedupeQueueByUrl é o import no topo.
  check("o limite da fila é aplicado sobre linhas ordenadas, e o dedup vem depois",
    prefetch.indexOf('.order("scheduled_at"') < prefetch.lastIndexOf("dedupeQueueByUrl") &&
    prefetch.indexOf(".limit(1000)") < prefetch.lastIndexOf("dedupeQueueByUrl"));
  check("existe claim atômico por Reel (run da Apify é pago)",
    /claimed_until/.test(prefetch) && /claimed_until\.lt\./.test(prefetch));
  check("orçamento compatível com maxDuration=300", /BUDGET_MS = 250_000/.test(prefetch));
  check("auto-heal devolve post quebrado para o permalink original",
    /video_url: row\.clone_source_url/.test(prefetch));

  console.log("\n== 5. A limpeza por idade de temp/ não alcança a mídia do Clone ==\n");

  const loops = src(LOOPS);
  const prefixos = loops.match(/TEMP_PREFIXES = \[([^\]]+)\]/);
  check("TEMP_PREFIXES continua restrito a temp/", !!prefixos);
  check("a limpeza por idade só lista a pasta temp/",
    /\.list\("temp"/.test(loops) && !/\.list\("clone"/.test(loops));

  console.log("\n== 6. Criação da campanha ==\n");

  const create = stripComments(src(CREATE));
  check("clone_source_url é gravado em cada post",
    /clone_source_url:\s*permalink/.test(create));
  check("video_url nasce no permalink (o prefetch troca depois)",
    /video_url:\s*permalink/.test(create));
  check("conta inativa ou com erro é recusada na criação",
    /!a\.is_active \|\| a\.health_status === "error"/.test(create));
  check("a validação de conta acontece ANTES de montar as linhas",
    create.indexOf("is_active") < create.indexOf("rows.push"));
  check("start_at inválido vira 400 (e não NaN no agendamento)",
    /Number\.isNaN\(new Date\(start_at\)\.getTime\(\)\)/.test(create));
  check("ownership das contas continua validado",
    /ownedAccounts\?\.length \?\? 0\) !== account_ids\.length/.test(create));

  console.log("\n== 7. Busca do perfil ==\n");

  const search = stripComments(src(SEARCH));
  const poll = stripComments(src(POLL));
  check("maxRequestsPerCrawl igual ao das Inspirações (fluxo validado)",
    /Math\.max\(600, limit \* 2\)/.test(search));
  check("o fallback do poll usa o mesmo teto",
    /Math\.max\(600, limit \* 2\)/.test(poll));
  check("o dataset é lido paginado (perfil com +1000 itens)",
    poll.includes("listAllItems"));
  check("a busca exige usuário autenticado",
    /getUser\(\)/.test(search) && /Não autenticado/.test(search));

  console.log("\n== 8. Tela do Clone ==\n");

  const page = stripComments(src(PAGE));
  check("contas inativas não aparecem para seleção",
    /a\.health_status !== "error" && a\.is_active/.test(page));
  check("a busca em andamento sobrevive ao reload",
    page.includes("PENDING_SEARCH_KEY") && /localStorage\.setItem\(PENDING_SEARCH_KEY/.test(page));
  check("o polling tem teto de tempo", /SEARCH_TIMEOUT_MS/.test(page));
  check("erro de rede pontual não derruba a busca inteira",
    !/catch\s*\{\s*if \(pollRef\.current\) clearInterval\(pollRef\.current\);\s*setSearchError/.test(page));
  check("a legenda original viaja com o Reel até o agendamento",
    /originalCaption: r\.originalCaption/.test(page));

  console.log("\n== 9. Publicação ==\n");

  const pub = stripComments(src("app/api/cron/publish-scheduled/route.ts"));
  check("posts de clone ainda não resolvidos não entram no lote",
    /\.not\("video_url", "ilike", "%instagram\.com%"\)/.test(pub));

  console.log("\n== 10. Migration ==\n");

  const sql = src("supabase/clone_media.sql");
  check("clone_media tem UNIQUE por source_url (1 download por Reel)",
    /source_url\s+text\s+NOT NULL UNIQUE/.test(sql));
  check("clone_media tem RLS ligada", /ALTER TABLE public\.clone_media ENABLE ROW LEVEL SECURITY/.test(sql));
  check("scheduled_posts.clone_source_url criada", /ADD COLUMN IF NOT EXISTS clone_source_url text/.test(sql));

  console.log(`\n${passed} passaram, ${failed} falharam\n`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
