/**
 * Testes da rodada de fechamento (2026-09-06):
 *   1. share_to_feed — payload explícito para true, false e null
 *   2. exclusão de pasta atômica (RPC transacional)
 *   3. CRON_SECRET fail-closed
 *   4. proxies após a Meta em conexão direta
 *
 * Roda com:  node scripts/test-hardening.mjs
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
const exists = (rel) => fs.existsSync(path.join(repoRoot, rel));

function run(bin, args) {
  return new Promise((resolve, reject) => {
    const p = spawn(bin, args, { stdio: "ignore", shell: process.platform === "win32" });
    p.on("close", (c) => (c === 0 ? resolve() : reject(new Error(`${bin} exit ${c}`))));
    p.on("error", reject);
  });
}

async function compile(files, cacheName, stubUndici = false) {
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

  if (stubUndici) {
    fs.writeFileSync(path.join(buildDir, "lib", "undici-stub.js"), `
export const __calls = [];
export async function fetch(url, init) {
  __calls.push({ url: String(url), body: init?.body ?? "" });
  return { ok: true, status: 200,
    text: async () => JSON.stringify({ id: "c1" }),
    json: async () => ({ id: "c1", status_code: "FINISHED" }),
    headers: { get: () => null } };
}
`);
  }
  return buildDir;
}

function parseForm(body) {
  const out = {};
  for (const pair of String(body).split("&")) {
    const i = pair.indexOf("=");
    if (i > -1) out[pair.slice(0, i)] = decodeURIComponent(pair.slice(i + 1));
  }
  return out;
}

/** Esconde o token nos payloads mostrados no relatório. */
function sanitize(body) {
  return String(body).replace(/access_token=[^&]*/g, "access_token=***");
}

async function main() {
  console.log("\n== 1. share_to_feed: payload real por valor ==\n");

  // reel-captions entra junto: meta-publish importa dela a validação que barra
  // legenda fora dos limites antes de montar o payload.
  const buildDir = await compile(
    ["lib/meta-publish.ts", "lib/reel-captions.ts"], "asc-hardening-meta", true);
  const outFile = path.join(buildDir, "lib", "meta-publish.js");
  fs.writeFileSync(outFile,
    fs.readFileSync(outFile, "utf8")
      .replace(/from ["']undici["']/g, 'from "./undici-stub.js"')
      // O tsc emite `from "./reel-captions"` sem extensão; o loader ESM do Node
      // exige o `.js`. Só o build de teste precisa disso.
      .replace(/from "(\.\/[^"]+?)"/g, (m, p) => (p.endsWith(".js") ? m : `from "${p}.js"`)));
  const meta = await import(pathToFileURL(outFile).href);
  const stub = await import(pathToFileURL(path.join(buildDir, "lib", "undici-stub.js")).href);
  const calls = stub.__calls;

  // --- true
  calls.length = 0;
  await meta.createMediaContainerOnly("17841400000", "https://x.test/v.mp4", "legenda", "TOKEN_SECRETO", "REELS", true);
  const bodyTrue = calls[0].body;
  const formTrue = parseForm(bodyTrue);
  console.log(`     payload(true):  ${sanitize(bodyTrue)}`);
  check("TRUE: media_type=REELS presente", formTrue.media_type === "REELS");
  check("TRUE: share_to_feed=true presente e explícito", formTrue.share_to_feed === "true");
  check("TRUE: string share_to_feed=true está no corpo cru", bodyTrue.includes("share_to_feed=true"));

  // --- false
  calls.length = 0;
  await meta.createMediaContainerOnly("17841400000", "https://x.test/v.mp4", "legenda", "TOKEN_SECRETO", "REELS", false);
  const bodyFalse = calls[0].body;
  const formFalse = parseForm(bodyFalse);
  console.log(`     payload(false): ${sanitize(bodyFalse)}`);
  check("FALSE: media_type=REELS presente", formFalse.media_type === "REELS");
  check("FALSE: share_to_feed=false presente e explícito", formFalse.share_to_feed === "false");
  check("FALSE: string share_to_feed=false está no corpo cru", bodyFalse.includes("share_to_feed=false"));

  // --- null
  calls.length = 0;
  await meta.createMediaContainerOnly("17841400000", "https://x.test/v.mp4", "legenda", "TOKEN_SECRETO", "REELS", null);
  const bodyNull = calls[0].body;
  const formNull = parseForm(bodyNull);
  console.log(`     payload(null):  ${sanitize(bodyNull)}`);
  check("NULL: media_type=REELS presente", formNull.media_type === "REELS");
  check("NULL: share_to_feed ausente (compatibilidade com posts legados)",
    !("share_to_feed" in formNull) && !bodyNull.includes("share_to_feed"));

  // --- undefined (default do parâmetro) também omite
  calls.length = 0;
  await meta.createMediaContainerOnly("17841400000", "https://x.test/v.mp4", "legenda", "TOKEN_SECRETO", "REELS");
  check("UNDEFINED: share_to_feed ausente", !calls[0].body.includes("share_to_feed"));

  // --- token nunca aparece em log/uso indevido do helper
  check("Token não é logado pelo helper", !src("lib/meta-publish.ts").includes("console.log(`[meta-reel] share_to_feed=${shareToFeed} token"));

  fs.rmSync(buildDir, { recursive: true, force: true });

  console.log("\n== 2. Exclusão de pasta atômica ==\n");

  const folderRoute = src("app/api/library/folders/[id]/route.ts");
  const rpcSql = src("supabase/library_folder_delete_cascade.sql");

  check("Rota usa a RPC transacional delete_library_folder_cascade",
    folderRoute.includes('rpc("delete_library_folder_cascade"'));
  check("Rota remove o Storage DEPOIS da RPC (atômica no banco + limpeza física)",
    folderRoute.indexOf("delete_library_folder_cascade") <
      folderRoute.search(/storage[\s\S]{0,160}\.remove\(/));
  check("RPC declarada na migration versionada",
    rpcSql.includes("create or replace function public.delete_library_folder_cascade"));
  check("RPC é plpgsql (executa dentro de uma transação)",
    rpcSql.includes("language plpgsql"));
  check("RPC valida ownership antes de qualquer mutação",
    /select name into v_name[\s\S]{0,200}user_id = p_user_id/.test(rpcSql));
  check("RPC pausa loops e registra o motivo",
    rpcSql.includes("status = 'paused'") && rpcSql.includes("paused_reason"));
  check("RPC apaga os vídeos e a pasta, e devolve storage_paths",
    /delete from videos_library/i.test(rpcSql) && /delete from library_folders/i.test(rpcSql) &&
      rpcSql.includes("storage_paths"));
  check("RPC não é executável por anon/authenticated",
    rpcSql.includes("revoke all on function") && rpcSql.includes("grant execute on function") &&
    rpcSql.includes("to service_role"));

  console.log("\n== 3. CRON_SECRET fail-closed ==\n");

  const helper = src("lib/cron-auth.ts");
  check("Helper central existe", exists("lib/cron-auth.ts"));
  check("env ausente/vazia → 503 sem executar trabalho",
    /!cronSecret \|\| cronSecret\.trim\(\) === ""/.test(helper) && helper.includes("status: 503"));
  check("header ausente ou incorreto → 401",
    /!header \|\| !secureEquals/.test(helper) && helper.includes("status: 401"));
  check("comparação em tempo constante", helper.includes("timingSafeEqual"));
  check("hasValidCronSecret devolve false sem env var",
    /if \(!cronSecret \|\| cronSecret\.trim\(\) === ""\) return false;/.test(helper));

  // --- comportamental: compila o helper e exercita os 4 cenários de verdade
  const authBuild = await compile(["lib/cron-auth.ts"], "asc-hardening-cron");
  const authFile = path.join(authBuild, "lib", "cron-auth.js");
  // Node puro nao resolve "next/server" sem extensao
  fs.writeFileSync(authFile,
    fs.readFileSync(authFile, "utf8").replace(/from ["']next\/server["']/g, 'from "next/server.js"'));
  const authMod = await import(pathToFileURL(authFile).href);
  const req = (header) => new Request("https://x.test/api/cron/x", {
    headers: header ? { authorization: header } : {},
  });
  const originalSecret = process.env.CRON_SECRET;

  delete process.env.CRON_SECRET;
  let r = authMod.requireCronAuth(req("Bearer qualquer-coisa"));
  check("COMPORTAMENTAL: env ausente bloqueia (503) mesmo com header",
    r.ok === false && r.response.status === 503);
  check("COMPORTAMENTAL: env ausente → 'Bearer undefined' não passa",
    authMod.requireCronAuth(req("Bearer undefined")).ok === false);

  process.env.CRON_SECRET = "   ";
  check("COMPORTAMENTAL: env só com espaços bloqueia (503)",
    authMod.requireCronAuth(req("Bearer    ")).response?.status === 503);

  process.env.CRON_SECRET = "segredo-de-teste";
  check("COMPORTAMENTAL: header ausente → 401",
    authMod.requireCronAuth(req(null)).response?.status === 401);
  check("COMPORTAMENTAL: header incorreto → 401",
    authMod.requireCronAuth(req("Bearer errado")).response?.status === 401);
  check("COMPORTAMENTAL: header correto → permite",
    authMod.requireCronAuth(req("Bearer segredo-de-teste")).ok === true);
  check("COMPORTAMENTAL: hasValidCronSecret aceita o segredo cru (query param)",
    authMod.hasValidCronSecret("segredo-de-teste", false) === true);
  delete process.env.CRON_SECRET;
  check("COMPORTAMENTAL: hasValidCronSecret é false sem env var",
    authMod.hasValidCronSecret("Bearer qualquer") === false);

  if (originalSecret === undefined) delete process.env.CRON_SECRET;
  else process.env.CRON_SECRET = originalSecret;
  fs.rmSync(authBuild, { recursive: true, force: true });

  const cronDir = path.join(repoRoot, "app/api/cron");
  const cronRoutes = fs.readdirSync(cronDir).filter((d) =>
    fs.existsSync(path.join(cronDir, d, "route.ts")));
  const failOpen = [];
  const unprotected = [];
  for (const d of cronRoutes) {
    const rel = `app/api/cron/${d}/route.ts`;
    const code = src(rel);
    if (/if \(!cronSecret\)\s*\{/.test(code)) failOpen.push(d);
    const usesHelper = code.includes("requireCronAuth") || code.includes("hasValidCronSecret");
    if (!usesHelper) unprotected.push(d);
  }
  console.log(`     crons encontrados: ${cronRoutes.length} → ${cronRoutes.join(", ")}`);
  check(`Nenhum cron com padrão fail-open`, failOpen.length === 0, failOpen.join(", "));
  check("Todos os crons usam o helper central", unprotected.length === 0, unprotected.join(", "));
  check("Nenhum cron compara direto com process.env.CRON_SECRET",
    cronRoutes.every((d) => !/`Bearer \$\{process\.env\.CRON_SECRET\}`/.test(src(`app/api/cron/${d}/route.ts`))));

  const forceRun = src("app/api/cron/force-run/route.ts");
  check("force-run: aceita CRON_SECRET ou admin, nunca usuário comum",
    forceRun.includes("hasValidCronSecret") && forceRun.includes('=== "admin"') &&
    forceRun.includes("status: 403"));

  const vercel = JSON.parse(src("vercel.json"));
  check("sync-accounts continua SEM schedule (decisão de produto)",
    !vercel.crons.some((c) => c.path.includes("sync-accounts")));

  console.log("\n== 4. Proxies depois da Meta direta ==\n");

  const proxyLib = src("lib/proxy.ts");
  const callback = src("app/api/instagram/callback/route.ts");

  check("recordProxyFailure removido (estava sem callers)", !proxyLib.includes("recordProxyFailure"));
  check("isProxyNetworkError removido", !proxyLib.includes("export function isProxyNetworkError"));
  check("ProxyOutageBanner removido", !exists("components/dashboard/ProxyOutageBanner.tsx"));
  check("Dashboard não referencia mais o banner",
    !src("app/dashboard/layout.tsx").includes("ProxyOutageBanner") &&
    !src("app/dashboard/layout.tsx").includes("last_proxy_error_at"));
  check("Alerta push de queda de proxy removido",
    !src("app/api/cron/check-health-alerts/route.ts").includes("proxy"));
  check("Toggle de alerta de proxy removido da UI",
    !src("components/dashboard/NotificationAlertSettings.tsx").includes("Queda de proxy"));

  check("OAuth NÃO atribui mais proxy automaticamente",
    !callback.includes("claimProxyForAccount"));
  check("Conta nova nasce sem proxy (documentado no callback)",
    callback.includes("proxy_url = NULL"));

  // Nenhum fluxo OFICIAL da Meta pode depender de proxy.
  const oficiais = [
    "lib/meta-publish.ts", "lib/meta-refresh.ts", "lib/meta-insights.ts",
    "app/api/cron/publish-scheduled/route.ts", "app/api/cron/publish-pending/route.ts",
    "app/api/cron/process-loops/route.ts", "app/api/cron/story-templates/route.ts",
    "app/api/cron/sync-accounts/route.ts", "app/api/cron/sync-post-insights/route.ts",
    "app/api/cron/refresh-tokens/route.ts", "app/api/accounts/refresh/route.ts",
    "app/api/accounts/sync-all/route.ts", "app/api/accounts/stories/route.ts",
    "app/api/instagram/stories/route.ts", "app/api/instagram/callback/route.ts",
    "app/api/meta/insights/route.ts", "app/api/posts/create/route.ts",
    "app/api/posts/publish/route.ts", "app/api/analytics/sync/route.ts",
    "app/api/loops/[id]/analytics/route.ts", "app/api/stories/templates/import/route.ts",
  ];
  const stripComments = (code) =>
    code.replace(/\/\*[\s\S]*?\*\//g, "")
      .split(/\r?\n/)
      .filter((l) => !l.trim().startsWith("//"))
      .join("\n");
  const comProxy = oficiais.filter((f) =>
    /getProxyForAccount|proxyInit\(|dispatcher/.test(stripComments(src(f))));
  check("Nenhum fluxo oficial da Meta usa proxy", comProxy.length === 0, comProxy.join(", "));

  const comGuard = oficiais.filter((f) =>
    /\.not\("proxy_url", "is", null\)/.test(src(f)));
  check("Nenhum guard 'sem proxy = skip' em fluxo oficial", comGuard.length === 0, comGuard.join(", "));

  // Módulos que legitimamente ainda usam proxy.
  // A consulta anônima do checker sai por proxy (conta conectada ou estoque);
  // a via oficial (Business Discovery) segue em conexão direta.
  {
    const checker = src("app/api/instagram/checker/route.ts");
    check("checker (endpoint web não-oficial) mantém proxy",
      checker.includes("proxyInit") &&
      checker.includes("buildAgentFromEncrypted") &&
      checker.includes("proxy_pool"));
  }
  check("login via instagrapi mantém exigência de proxy dedicado",
    src("app/api/cron/process-instagram-logins/route.ts").includes("proxy_url"));
  check("estoque proxy_pool preservado", exists("lib/proxy-pool.ts") && exists("app/api/proxy-pool/route.ts"));

  // ── Auditoria 2026-09-12 ────────────────────────────────────────────────────
  console.log("\n== Auditoria 2026-09-12 ==");
  {
    const tpl = src("app/api/stories/templates/route.ts");
    check("templates de Story: embed instagram_accounts com FK explícita (sem PGRST201)",
      tpl.includes("instagram_accounts!story_templates_source_account_id_fkey(") &&
      !/"instagram_accounts\(username\), "/.test(tpl));

    check("force-run não ordena scheduled_posts por coluna inexistente",
      !src("app/api/cron/force-run/route.ts").includes('.order("updated_at"'));

    for (const f of ["app/api/cron/process-scrape-jobs/route.ts", "app/api/cron/process-instagram-logins/route.ts"]) {
      const s = src(f);
      check(`${path.basename(path.dirname(f))}: claim carimba retry_after`,
        /update\(\{ status: "processing", retry_after: new Date\(\)\.toISOString\(\) \}\)/.test(s));
      check(`${path.basename(path.dirname(f))}: auto-healing mede desde o claim, não created_at`,
        !/\.eq\("status", "processing"\)\s*\n\s*\.lt\("created_at"/.test(s) &&
        s.includes("retry_after.lt.${healCutoff}"));
    }

    const sql = src("supabase/revoke_public_rpc_execute.sql");
    for (const fn of ["delete_library_folder_cascade", "get_campaign_summaries", "get_account_video_usage"]) {
      check(`RPC ${fn} sem EXECUTE para anon/authenticated`, sql.includes(`public.${fn}(`));
    }

    // Views Totais: Loop incluído, sem apagar valor real, story sem `saved`.
    const cronIns = src("app/api/cron/sync-post-insights/route.ts");
    check("sync-post-insights sincroniza posts do Loop (pending_containers)",
      cronIns.includes('base("pending_containers"'));
    check("sync-post-insights filtra elegibilidade no banco (não em JS sobre lote fixo)",
      cronIns.includes("reelEligibility(") && !cronIns.includes("function isEligible"));
    const libIns = src("lib/meta-insights.ts");
    check("insights de Story não pedem métrica `saved` (Meta recusa a chamada inteira)",
      /story:\s*"views,reach,shares"/.test(libIns));
    check("gravação de insights omite métricas nulas (falha não zera views)",
      libIns.includes("export function insightsUpdatePayload") &&
      src("app/api/loops/[id]/analytics/route.ts").includes("insightsUpdatePayload(") &&
      src("app/api/meta/insights/route.ts").includes("insightsUpdatePayload("));
    const stats = src("app/api/dashboard/stats/route.ts");
    check("Dashboard usa views REAIS de conta (insight de conta), não soma de posts",
      stats.includes('rpc("get_account_views_summary"') && !stats.includes("viewsRows"));
    check("get_views_summary sem EXECUTE público",
      src("supabase/views_summary_rpc.sql").includes("revoke execute on function public.get_views_summary(uuid) from public, anon, authenticated"));
    check("get_account_views_summary sem EXECUTE público",
      src("supabase/account_views_daily.sql").includes("revoke execute on function public.get_account_views_summary(uuid) from public, anon, authenticated"));

    const mav = src("lib/meta-account-views.ts");
    check("views de conta por dia alinhado à meia-noite UTC (janelas desalinhadas contam em dobro)",
      mav.includes("Math.floor(nowMs / 1000 / DAY_S) * DAY_S") && mav.includes("metric_type=total_value"));
    check("falha intermitente da Meta (code=10) não descarta os dias já obtidos",
      mav.includes("result.failures++") && mav.includes("export interface DailyViewsResult"));
    const cronViews = src("app/api/cron/sync-account-views/route.ts");
    check("backfill só é marcado concluído sem dias recusados",
      cronViews.includes("needsBackfill && backfillFailures === 0"));
    check("cron sync-account-views agendado no vercel.json",
      src("vercel.json").includes('"/api/cron/sync-account-views"'));

    const upload = src("app/api/stories/upload/route.ts");
    check("upload de Story não recebe o arquivo pela Vercel (limite 4,5 MB)",
      !upload.includes("formData()") && upload.includes("createSignedUploadUrl"));
    const complete = src("app/api/stories/upload/complete/route.ts");
    check("confirmação de upload valida dono do caminho e metadados do Storage",
      complete.includes("stories/${user.id}/") && complete.includes("meta.mimetype") && complete.includes(".remove(["));
  }

  console.log(`\n${passed} passaram, ${failed} falharam\n`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
