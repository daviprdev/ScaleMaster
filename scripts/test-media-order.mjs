/**
 * Seleção visual de vídeos + ordem de publicação (aba Postar) — testes.
 *
 * Duas camadas:
 *   1. COMPORTAMENTAL — compila `lib/media-order.ts` e executa as funções de
 *      verdade (ordem de clique, dedup, validação, pool exato vs. aleatório,
 *      quadrado latino).
 *   2. ESTRUTURAL — guardas sobre o route de distribuição e a UI, para que uma
 *      refatoração futura não volte a: tratar `[]` como "todos", quebrar o
 *      caminho legado, separar vídeo de legenda ou reembaralhar em retry.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { execFileSync } from "node:child_process";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const src = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
const semComentarios = (t) =>
  t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

let passed = 0, failed = 0;
const check = (nome, ok) => {
  if (ok) { passed++; console.log(`  PASS  ${nome}`); }
  else { failed++; console.log(`  FAIL  ${nome}`); }
};

const buildDirs = [];
function compilar(relPaths) {
  const out = fs.mkdtempSync(path.join(ROOT, ".tmp-test-mo-"));
  buildDirs.push(out);
  execFileSync(
    process.platform === "win32" ? "npx.cmd" : "npx",
    ["tsc", ...relPaths.map((p) => path.join(ROOT, p)), "--outDir", out,
     "--target", "es2022", "--module", "es2022", "--moduleResolution", "bundler",
     "--skipLibCheck"],
    { stdio: "pipe", shell: process.platform === "win32" }
  );
  for (const arquivo of fs.readdirSync(out).filter((f) => f.endsWith(".js"))) {
    const p = path.join(out, arquivo);
    fs.writeFileSync(p, fs.readFileSync(p, "utf8").replace(/from "(\.\/[^"]+?)"/g, 'from "$1.js"'));
  }
  return out;
}

const vid = (id) => ({ id, public_url: `https://x/${id}.mp4`, caption: `cap-${id}` });

async function main() {
  const out = compilar(["lib/media-order.ts"]);
  const mo = await import(pathToFileURL(path.join(out, "media-order.js")).href);
  const {
    normalizeMediaOrder, hasExplicitSelection, resolveSelectedVideos,
    buildSelectedPool, videoForRound, videoForSequence,
  } = mo;

  // identidade sem embaralhar — deixa "random" == "selected" para os testes de ordem
  const noShuffle = (a) => [...a];

  // ── normalizeMediaOrder ────────────────────────────────────────────────────
  check("normalizeMediaOrder: 'random' → random", normalizeMediaOrder("random") === "random");
  check("normalizeMediaOrder: 'selected' → selected", normalizeMediaOrder("selected") === "selected");
  check("normalizeMediaOrder: ausente → selected (padrão)", normalizeMediaOrder(undefined) === "selected");
  check("normalizeMediaOrder: lixo → selected", normalizeMediaOrder("xyz") === "selected");

  // ── hasExplicitSelection ───────────────────────────────────────────────────
  check("hasExplicitSelection: [] → false (legado, nunca 'todos')", hasExplicitSelection([]) === false);
  check("hasExplicitSelection: undefined → false", hasExplicitSelection(undefined) === false);
  check("hasExplicitSelection: ['a'] → true", hasExplicitSelection(["a"]) === true);

  // ── resolveSelectedVideos: ordem de clique preservada ──────────────────────
  const byId = new Map([vid("C"), vid("A"), vid("F"), vid("Z")].map(v => [v.id, v]));
  {
    const r = resolveSelectedVideos(["C", "A", "F"], byId);
    check("clique C,A,F → ordem C,A,F", r.ok && r.videos.map(v => v.id).join(",") === "C,A,F");
    // a legenda acompanha o vídeo (nunca separa)
    check("cada vídeo mantém a própria legenda", r.ok && r.videos.every(v => v.caption === `cap-${v.id}`));
  }
  {
    // desmarcar A e a lista renumera: C,F
    const r = resolveSelectedVideos(["C", "F"], byId);
    check("desmarcar A → C,F", r.ok && r.videos.map(v => v.id).join(",") === "C,F");
  }
  {
    // reselecionar A vai para o fim
    const r = resolveSelectedVideos(["C", "F", "A"], byId);
    check("reselecionar A → C,F,A", r.ok && r.videos.map(v => v.id).join(",") === "C,F,A");
  }
  {
    // dedup preserva 1ª ocorrência
    const r = resolveSelectedVideos(["C", "A", "C", "F", "A"], byId);
    check("dedup preserva 1ª ocorrência (C,A,F)", r.ok && r.videos.map(v => v.id).join(",") === "C,A,F");
  }
  {
    // id fora da pasta/dono/inexistente → rejeita
    const r = resolveSelectedVideos(["C", "NOPE"], byId);
    check("id inválido → rejeita com invalidId", r.ok === false && r.invalidId === "NOPE");
  }

  // ── buildSelectedPool ──────────────────────────────────────────────────────
  const selecionados = ["C", "A", "F"].map(id => byId.get(id));
  {
    const pool = buildSelectedPool(selecionados, "selected", noShuffle);
    check("pool 'selected' = ordem exata C,A,F", pool.map(v => v.id).join(",") === "C,A,F");
  }
  {
    // random usa SOMENTE os selecionados (nunca busca outro da pasta)
    const embaralhado = (a) => [...a].reverse();
    const pool = buildSelectedPool(selecionados, "random", embaralhado);
    const ids = pool.map(v => v.id).sort().join(",");
    check("pool 'random' contém só os selecionados", ids === "A,C,F" && pool.length === 3);
    check("pool 'random' não injeta Z (não selecionado)", !pool.some(v => v.id === "Z"));
  }

  // ── "NA ORDEM QUE ESCOLHI" = sequência LITERAL, igual para todas as contas ──
  {
    const pool = buildSelectedPool(selecionados, "selected", noShuffle); // [C,A,F]
    // Uma conta consome C,A,F,C,A,F… (nunca C,A,F / A,F,C / F,C,A).
    const seq = [0,1,2,3,4,5].map(r => videoForSequence(pool, r).id).join(",");
    check("selected: sequência = C,A,F,C,A,F (ordem de clique, ciclando)", seq === "C,A,F,C,A,F");

    // TODAS as contas usam a MESMA sequência — sem rotação por conta. Simula o
    // fluxo real do route: para cada conta (ai), cada rodada (vi) → pool[vi].
    const contas = 6, postsPorConta = 3;
    const porConta = [];
    for (let ai = 0; ai < contas; ai++) {
      porConta.push([...Array(postsPorConta)].map((_, vi) => videoForSequence(pool, vi).id).join(","));
    }
    check("selected: 6 contas → todas C,A,F (sem defasagem por conta)",
      porConta.every(s => s === "C,A,F"));

    // Prova explícita de que NÃO é a rotação antiga (C,A,F / A,F,C / F,C,A).
    check("selected: conta 2 NÃO começa em A (sem quadrado latino)",
      videoForSequence(pool, 0).id === "C" && porConta[1].startsWith("C"));

    // A legenda acompanha o vídeo em cada posição da sequência.
    check("selected: legenda ligada ao vídeo em cada passo",
      [0,1,2].every(r => { const v = videoForSequence(pool, r); return v.caption === `cap-${v.id}`; }));
  }

  // ── videoForRound (quadrado latino) — usado em ALEATÓRIA e LEGADO, não aqui ──
  {
    const pool = buildSelectedPool(selecionados, "selected", noShuffle); // [C,A,F]
    const conta0 = [0,1,2,3,4,5].map(r => videoForRound(pool, 0, r).id).join(",");
    check("latin square: conta 0 → C,A,F,C,A,F", conta0 === "C,A,F,C,A,F");
    const conta1 = [0,1,2].map(r => videoForRound(pool, 1, r).id).join(",");
    check("latin square: conta 1 → A,F,C (defasado — só random/legado)", conta1 === "A,F,C");
    const rodada0 = [0,1,2].map(ai => videoForRound(pool, ai, 0).id);
    check("latin square: rodada 0 → 3 contas, 3 vídeos distintos", new Set(rodada0).size === 3);
  }

  // ── ESTRUTURAL: route de distribuição ──────────────────────────────────────
  const routeSrc = semComentarios(src("app/api/posts/distribute/route.ts"));
  check("route importa media-order", /from ["']@\/lib\/media-order["']/.test(routeSrc));
  check("route usa hasExplicitSelection (separa legado de seleção)", /hasExplicitSelection\(/.test(routeSrc));
  check("route valida a seleção com resolveSelectedVideos", /resolveSelectedVideos\(/.test(routeSrc));
  check("route monta o mapa por id a partir de allVideos (owner+pasta)", /new Map\(allVideos\.map/.test(routeSrc));
  check("route rejeita id inválido com 400", /!resolved\.ok\)[\s\S]{0,400}status:\s*400/.test(routeSrc));
  check("route mantém caminho legado com fetchVideoUsage", /fetchVideoUsage\(/.test(routeSrc));
  check("route pula sync quando há seleção (!hasSelection)", /!hasSelection\s*&&/.test(routeSrc));
  // A legenda continua saindo do vídeo escolhido (snapshot por vídeo).
  check("route resolve legenda a partir do vídeo da rodada", /originalCaption:\s*video\.caption/.test(routeSrc));

  // "Na ordem que escolhi" = sequência literal (sem offset por conta) no route.
  check("route define respectExactOrder = hasSelection && selected",
    /respectExactOrder\s*=\s*hasSelection\s*&&\s*mediaOrder\s*===\s*["']selected["']/.test(routeSrc));
  check("route usa videoForSequence (literal) quando respectExactOrder",
    /respectExactOrder[\s\S]{0,120}pickVideoInSequence\(sharedPool,\s*round\)/.test(routeSrc));
  // SNAPSHOT: video_id/video_url gravados no post concreto — congela a escolha.
  check("route congela video_id no scheduled_posts (snapshot)", /video_id:\s*video\.id/.test(routeSrc));
  check("route congela video_url no scheduled_posts (snapshot)", /video_url:\s*video\.public_url/.test(routeSrc));

  // RETRY não reembaralha: quem publica (publish-scheduled) só relê a linha —
  // não importa media-order nem re-sorteia o vídeo.
  const publishSrc = semComentarios(src("app/api/cron/publish-scheduled/route.ts"));
  check("publish-scheduled NÃO importa media-order (retry não reordena)",
    !/@\/lib\/media-order/.test(publishSrc));
  check("publish-scheduled NÃO embaralha (sem fisherYates/shuffle)",
    !/fisherYates|shuffle/i.test(publishSrc));

  // Redação: a defasagem NÃO é apresentada como regra oficial da Meta.
  const moSrc = src("lib/media-order.ts");
  check("media-order: defasagem descrita como estratégia interna, não regra da Meta",
    /estrat[ée]gia interna|hip[óo]tese operacional/i.test(moSrc) && !/a Meta suprime/i.test(moSrc));
  check("distribute route: sem afirmação de que 'a Meta suprime'", !/a Meta suprime/i.test(routeSrc));

  // ── ESTRUTURAL: library GET idsOnly ────────────────────────────────────────
  const libSrc = semComentarios(src("app/api/library/route.ts"));
  check("library GET tem modo idsOnly", /idsOnly/.test(libSrc));
  check("idsOnly é owner-scoped (eq user_id)", /idsOnly[\s\S]{0,400}eq\("user_id"/.test(libSrc));

  // ── ESTRUTURAL: UI Postar ──────────────────────────────────────────────────
  const uiSrc = semComentarios(src("app/dashboard/postar/page.tsx"));
  check("UI envia selected_video_ids só quando há seleção", /selected_video_ids:\s*hasVideoSelection\s*\?/.test(uiSrc));
  check("UI envia media_order só quando há seleção", /media_order:\s*hasVideoSelection\s*\?/.test(uiSrc));
  check("UI limpa seleção ao trocar de pasta", /setSelectedVideoIds\(\[\]\)/.test(uiSrc));
  check("UI tem seção ORDEM DAS MÍDIAS", /Ordem das mídias/i.test(uiSrc));
  check("UI desabilita sync com seleção ativa (!hasVideoSelection)", /fullySelectedFolders\.length > 0 && !hasVideoSelection/.test(uiSrc));
  check("UI 'Selecionar todas' usa idsOnly", /idsOnly=1/.test(uiSrc));

  // cleanup
  for (const d of buildDirs) { try { fs.rmSync(d, { recursive: true, force: true }); } catch {} }

  console.log(`\n  ${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
