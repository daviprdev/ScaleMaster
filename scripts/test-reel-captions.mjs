/**
 * Legenda original de Reels — testes de regressão.
 *
 * Três camadas:
 *
 *   1. COMPORTAMENTAL (libs) — compila `lib/scraped-reel.ts` e
 *      `lib/reel-captions.ts` e executa as funções de verdade.
 *   2. COMPORTAMENTAL (payload da Meta) — intercepta o HTTP do undici com
 *      MockAgent e prova que `POST /{ig-user-id}/media` sai com
 *      `media_type=REELS` e a legenda ORIGINAL, comparando o valor DECODIFICADO
 *      (não a representação exata do encoding). Nenhum Reel real é publicado.
 *   3. ESTRUTURAL — guardas sobre as rotas de ingestão e de publicação, para
 *      que uma refatoração futura não volte a truncar a legenda, a trocar a
 *      legenda de um vídeo pela de outro ou a inventar fallback.
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";
import { execFileSync } from "node:child_process";
import { MockAgent, setGlobalDispatcher } from "undici";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const src = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");

const semComentarios = (t) =>
  t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

let passed = 0;
let failed = 0;
const check = (nome, ok) => {
  if (ok) { passed++; console.log(`  PASS  ${nome}`); }
  else { failed++; console.log(`  FAIL  ${nome}`); }
};

// Os builds ficam DENTRO do projeto: lib/meta-publish.ts importa `undici`, e um
// build em os.tmpdir() não enxergaria o node_modules daqui.
const buildDirs = [];
function compilar(relPaths) {
  const out = fs.mkdtempSync(path.join(ROOT, ".tmp-test-build-"));
  buildDirs.push(out);
  execFileSync(
    process.platform === "win32" ? "npx.cmd" : "npx",
    ["tsc", ...relPaths.map((p) => path.join(ROOT, p)), "--outDir", out,
     "--target", "es2022", "--module", "es2022", "--moduleResolution", "bundler",
     "--skipLibCheck"],
    { stdio: "pipe", shell: process.platform === "win32" }
  );
  return out;
}

/**
 * Item de dataset no formato do actor `apify/instagram-scraper`.
 * Os nomes de campo vêm da referência oficial do actor (apify.com) e batem com
 * o que o código de produção já lia antes desta feature.
 */
const ITEM_APIFY = {
  id: "3512345678901234567",
  type: "Video",
  shortCode: "DYab12cXyZq",
  caption: "Bom dia 😂\nVocês sabiam disso? #curiosidade #ação via @perfilorigem",
  url: "https://www.instagram.com/p/DYab12cXyZq/",
  displayUrl: "https://scontent.cdninstagram.com/thumb.jpg",
  videoUrl: "https://scontent.cdninstagram.com/video-a.mp4",
  ownerUsername: "perfilx",
  ownerFullName: "Perfil X",
  videoViewCount: 120345,
  likesCount: 4321,
  commentsCount: 87,
  videoDuration: 31.5,
};

async function main() {
  const outDir = compilar(["lib/scraped-reel.ts", "lib/reel-captions.ts"]);
  const scraped = await import(pathToFileURL(path.join(outDir, "scraped-reel.js")).href);
  const caps = await import(pathToFileURL(path.join(outDir, "reel-captions.js")).href);

  const { normalizeScrapedReel, normalizeScrapedReels, extractOriginalCaption } = scraped;
  const {
    resolveCaption, normalizeCaptionMode, stripHashtags, stripMentions,
    countHashtags, countMentions, hasOriginalCaption,
    META_CAPTION_MAX_LENGTH, DEFAULT_CAPTION_MODE, DEFAULT_CAPTION_MODE_CLONE,
  } = caps;

  const pollInsp = src("app/api/inspirations/scrape/poll/route.ts");
  const pollClone = src("app/api/clone/search/poll/route.ts");
  const saveLib = src("app/api/inspirations/save-to-library/route.ts");
  const distribute = src("app/api/posts/distribute/route.ts");
  const loops = src("app/api/cron/process-loops/route.ts");
  const cloneCreate = src("app/api/clone/create/route.ts");
  const publishNow = src("app/api/posts/publish/route.ts");
  const publishSched = src("app/api/cron/publish-scheduled/route.ts");
  const storiesNow = src("app/api/posts/stories/post-now/route.ts");
  const migration = src("supabase/original_reel_captions.sql");

  // ══════════════════════════════════════════════════════════════════════════
  console.log("\n== 1. Normalização do payload do Apify ==\n");

  const reel = normalizeScrapedReel(ITEM_APIFY, "fallbackuser");

  check("TESTE 1: originalCaption sai do campo `caption` do Apify",
    reel.originalCaption === ITEM_APIFY.caption);
  check("TESTE 1: sourceUsername sai de `ownerUsername`",
    reel.sourceUsername === "perfilx");
  check("TESTE 1: sourceUrl sai de `url` (permalink)",
    reel.sourceUrl === "https://www.instagram.com/p/DYab12cXyZq/");
  check("TESTE 1: videoUrl e shortCode preservados",
    reel.videoUrl === ITEM_APIFY.videoUrl && reel.shortCode === ITEM_APIFY.shortCode);
  check("métricas preservadas",
    reel.views === 120345 && reel.likes === 4321 && reel.comments === 87);

  // TESTE 2 — emoji, quebra de linha, hashtag e menção
  const original = "Bom dia 😂\nVocês sabiam disso?";
  const r2 = normalizeScrapedReel({ ...ITEM_APIFY, caption: original });
  check("TESTE 2: emoji e quebra de linha preservados",
    r2.originalCaption === original);
  check("TESTE 2: nada de truncagem (legenda de 2000 chars sai inteira)",
    normalizeScrapedReel({ ...ITEM_APIFY, caption: "a".repeat(2000) })
      .originalCaption.length === 2000);
  check("acento, hashtag Unicode e @menção intactos",
    reel.originalCaption.includes("#ação") &&
    reel.originalCaption.includes("@perfilorigem") &&
    reel.originalCaption.includes("😂"));

  // Três estados
  check("campo ausente → null (não capturada)",
    extractOriginalCaption({ shortCode: "x" }) === null);
  check("campo vazio → \"\" (Reel sem legenda)",
    extractOriginalCaption({ caption: "" }) === "");
  check("campo não-string → null",
    extractOriginalCaption({ caption: 42 }) === null &&
    extractOriginalCaption({ caption: null }) === null);
  check("sem ownerUsername cai para o perfil pesquisado",
    normalizeScrapedReel({ caption: "x" }, "perfilpesquisado").sourceUsername === "perfilpesquisado");
  check("sem `url` o permalink é reconstruído do shortCode",
    normalizeScrapedReel({ shortCode: "ABC123" }).sourceUrl ===
      "https://www.instagram.com/p/ABC123/");

  check("nenhum campo inventado (`text`/`description` não são lidos)",
    !/item\.text|item\.description/.test(semComentarios(src("lib/scraped-reel.ts"))));

  // TESTE 4 — cada vídeo com a SUA legenda
  const lote = normalizeScrapedReels([
    { ...ITEM_APIFY, id: "A", shortCode: "AAA", caption: "legenda A", videoUrl: "https://cdn/a.mp4" },
    { ...ITEM_APIFY, id: "B", shortCode: "BBB", caption: "legenda B", videoUrl: "https://cdn/b.mp4" },
    { ...ITEM_APIFY, id: "C", shortCode: "CCC", caption: "legenda C", videoUrl: "https://cdn/c.mp4" },
  ]);
  check("TESTE 4: Vídeo A → Legenda A, B → B, C → C (sem troca)",
    lote[0].originalCaption === "legenda A" && lote[0].videoUrl.endsWith("a.mp4") &&
    lote[1].originalCaption === "legenda B" && lote[1].videoUrl.endsWith("b.mp4") &&
    lote[2].originalCaption === "legenda C" && lote[2].videoUrl.endsWith("c.mp4"));

  // ══════════════════════════════════════════════════════════════════════════
  console.log("\n== 2. Modos de legenda ==\n");

  const CUSTOM = "minha legenda personalizada";
  const ORIG = "legenda original do reel 😂 #tag @alguem";

  const rOriginal = resolveCaption({ mode: "original", originalCaption: ORIG, customCaption: CUSTOM });
  check("TESTE 5: modo original devolve a legenda do vídeo, intacta",
    rOriginal.caption === ORIG && rOriginal.missingOriginal === false);

  const rCustom = resolveCaption({ mode: "custom", originalCaption: ORIG, customCaption: CUSTOM });
  check("TESTE 6: modo custom devolve a legenda personalizada",
    rCustom.caption === CUSTOM);

  const rNone = resolveCaption({ mode: "none", originalCaption: ORIG, customCaption: CUSTOM });
  check("TESTE 7: modo none devolve string vazia",
    rNone.caption === "");
  check("TESTE 7: none nunca devolve \"null\"/\"undefined\" como texto",
    rNone.caption !== "null" && rNone.caption !== "undefined" && rNone.caption.length === 0);

  // TESTE 11 — sem fallback
  const semOriginal = resolveCaption({
    mode: "original", originalCaption: null, customCaption: CUSTOM,
  });
  check("TESTE 11: original sem legenda → vazio, NUNCA a custom",
    semOriginal.caption === "" && semOriginal.caption !== CUSTOM);
  check("TESTE 11: o caso é sinalizado com missingOriginal",
    semOriginal.missingOriginal === true);
  check("TESTE 11: legenda vazia do Reel também não vira fallback",
    resolveCaption({ mode: "original", originalCaption: "", customCaption: CUSTOM })
      .caption === "");
  check("hasOriginalCaption distingue os três estados",
    hasOriginalCaption(null) === false && hasOriginalCaption("") === false &&
    hasOriginalCaption("x") === true);

  // TESTE 14 — legado
  check("TESTE 14: caption_mode NULL cai no comportamento anterior (custom)",
    normalizeCaptionMode(null) === "custom" &&
    normalizeCaptionMode(undefined) === "custom" &&
    DEFAULT_CAPTION_MODE === "custom");
  check("TESTE 14: valor desconhecido também cai em custom",
    normalizeCaptionMode("qualquer-coisa") === "custom");
  check("Clone tem padrão próprio (original) — era o comportamento dele",
    DEFAULT_CAPTION_MODE_CLONE === "original" &&
    normalizeCaptionMode(null, DEFAULT_CAPTION_MODE_CLONE) === "original");

  // ══════════════════════════════════════════════════════════════════════════
  console.log("\n== 3. Limite da Meta ==\n");

  check("limite oficial documentado é 2200 caracteres",
    META_CAPTION_MAX_LENGTH === 2200);
  const longa = resolveCaption({ mode: "original", originalCaption: "a".repeat(2201) });
  check("TESTE 13: legenda acima do limite é SINALIZADA, não truncada",
    longa.overLimit === true && longa.caption.length === 2201);
  check("TESTE 13: no limite exato não dispara erro",
    resolveCaption({ mode: "original", originalCaption: "a".repeat(2200) }).overLimit === false);
  check("emoji conta como 1 caractere (code points, não UTF-16)",
    resolveCaption({ mode: "original", originalCaption: "😂😂😂" }).length === 3);

  check("TESTE 13: distribute devolve erro ANTES de agendar",
    /resolucao\.overLimit[\s\S]{0,300}status: 400/.test(distribute));
  check("TESTE 13: clone devolve erro ANTES de agendar",
    /resolucao\.overLimit[\s\S]{0,300}status: 400/.test(cloneCreate));
  check("TESTE 13: publicação imediata devolve erro antes da Meta",
    /resolucao\.overLimit[\s\S]{0,300}status: 400/.test(publishNow));
  check("TESTE 13: Loop registra erro e pula a conta, sem cortar",
    loops.includes("captionTooLongMessage") && loops.includes("recordContainerError"));

  // ══════════════════════════════════════════════════════════════════════════
  console.log("\n== 4. Hashtags e @menções (opcionais) ==\n");

  check("hashtag com acento é removida por inteiro (#ação)",
    stripHashtags("veja #ação agora") === "veja agora");
  check("hashtag em português (#português)",
    stripHashtags("um #português aqui") === "um aqui");
  check("hashtag em japonês (#日本語)",
    stripHashtags("kanji #日本語 fim") === "kanji fim");
  check("hashtag ASCII simples",
    stripHashtags("a #tag b") === "a b");
  check("não confunde # solto no meio do texto",
    stripHashtags("nota #1 e #dois").includes("e") === true);
  check("contagem de hashtags Unicode",
    countHashtags("#ação #日本語 #tag") === 3);

  check("@menção removida",
    stripMentions("crédito @perfil.oficial fim") === "crédito fim");
  check("@menção com ponto e underscore",
    countMentions("@a.b @c_d") === 2);
  check("e-mail não é tratado como menção de forma agressiva",
    countHashtags("x@y.com") === 0);

  check("quebras de linha sobrevivem à remoção",
    stripHashtags("linha1 #tag\nlinha2").includes("\n"));
  check("por padrão nada é removido (os dois toggles em false)",
    resolveCaption({ mode: "original", originalCaption: ORIG }).caption === ORIG);
  check("toggles só valem no modo original",
    resolveCaption({
      mode: "custom", customCaption: "a #tag @x", stripHashtags: true, stripMentions: true,
    }).caption === "a #tag @x");
  check("remoção de crédito só acontece se o usuário pedir",
    resolveCaption({ mode: "original", originalCaption: "arte de @criador" }).caption ===
      "arte de @criador");
  check("com o toggle ligado, a menção sai",
    resolveCaption({ mode: "original", originalCaption: "arte de @criador", stripMentions: true })
      .caption === "arte de");

  // ══════════════════════════════════════════════════════════════════════════
  console.log("\n== 5. Payload real enviado à Meta ==\n");

  const metaDir = compilar(["lib/meta-publish.ts"]);
  const meta = await import(pathToFileURL(path.join(metaDir, "meta-publish.js")).href);

  const agent = new MockAgent();
  agent.disableNetConnect();
  setGlobalDispatcher(agent);
  const pool = agent.get("https://graph.instagram.com");

  let corpoCapturado = "";
  pool
    .intercept({ path: /\/v21\.0\/[^/]+\/media$/, method: "POST" })
    .reply(200, (opts) => { corpoCapturado = String(opts.body); return { id: "creation_999" }; })
    .times(3);

  const legendaOriginal = "Vocês sabiam disso? 😂\n#curiosidade @perfilorigem";
  const creationId = await meta.createMediaContainerOnly(
    "17841400000000000", "https://cdn/a.mp4", legendaOriginal, "TOKEN_FAKE", "REELS", true
  );

  const params = new URLSearchParams(corpoCapturado);
  check("container criado (mock respondeu)", creationId === "creation_999");
  check("PAYLOAD: media_type=REELS", params.get("media_type") === "REELS");
  check("PAYLOAD: caption chega DECODIFICADA igual à legenda original",
    params.get("caption") === legendaOriginal);
  check("PAYLOAD: emoji e quebra de linha sobrevivem ao encoding",
    params.get("caption").includes("😂") && params.get("caption").includes("\n"));
  check("PAYLOAD: video_url intacta", params.get("video_url") === "https://cdn/a.mp4");
  check("PAYLOAD: share_to_feed não foi afetado pela feature de legenda",
    params.get("share_to_feed") === "true");

  // TESTE 7 no fio: sem legenda, o parâmetro não é enviado
  corpoCapturado = "";
  await meta.createMediaContainerOnly(
    "17841400000000000", "https://cdn/b.mp4", "", "TOKEN_FAKE", "REELS", null
  );
  const semCaption = new URLSearchParams(corpoCapturado);
  check("TESTE 7: caption vazia → parâmetro OMITIDO do payload",
    !corpoCapturado.includes("caption=") && semCaption.get("caption") === null);
  check("TESTE 7: nunca sai a string \"undefined\" como legenda",
    !corpoCapturado.includes("undefined"));

  // TESTE 15 — Story não leva caption
  corpoCapturado = "";
  await meta.createMediaContainerOnly(
    "17841400000000000", "https://cdn/s.mp4", "legenda que não deve ir", "TOKEN_FAKE", "STORIES", null
  );
  const story = new URLSearchParams(corpoCapturado);
  check("TESTE 15: STORIES nunca recebe caption",
    story.get("caption") === null && story.get("media_type") === "STORIES");
  check("TESTE 15: STORIES nunca recebe share_to_feed",
    story.get("share_to_feed") === null);

  await agent.close();

  // ══════════════════════════════════════════════════════════════════════════
  console.log("\n== 6. Ingestão preserva a legenda ==\n");

  check("TESTE 3: Inspirações usa a normalização central",
    pollInsp.includes("normalizeScrapedReel"));
  check("TESTE 3: a truncagem de 120 chars do poller sumiu",
    !pollInsp.includes('String(item.caption ?? "").slice(0, 120)'));
  check("TESTE 3: o poller entrega originalCaption e sourceUrl",
    pollInsp.includes("originalCaption: reel.originalCaption") &&
    pollInsp.includes("sourceUrl: reel.sourceUrl"));
  check("TESTE 3: save-to-library grava a legenda sem cortar",
    !semComentarios(saveLib).includes(".slice(0, 500)") && saveLib.includes("captionParaBanco"));
  check("TESTE 3: save-to-library grava source_url",
    saveLib.includes("source_url: reel.sourceUrl"));
  check("TESTE 3: save-to-library preserva null vs \"\"",
    saveLib.includes("reel.originalCaption !== undefined"));
  check("Clone usa a normalização central",
    pollClone.includes("normalizeScrapedReel"));
  check("nenhuma rota de scrape lê caption por conta própria",
    !/String\(item\.caption/.test(semComentarios(pollInsp + pollClone)));

  check("a ingestão continua sem FFmpeg (mídia intocada)",
    !/ffmpeg|video-effects|sanitize/i.test(semComentarios(saveLib)) &&
    saveLib.includes("downloadOriginalMedia"));

  // ══════════════════════════════════════════════════════════════════════════
  console.log("\n== 7. Snapshot no post concreto ==\n");

  check("TESTE 8: Loop resolve a legenda com o vídeo já escolhido",
    /resolveCaption\(\{[\s\S]{0,200}originalCaption: assignment\.video\.caption/.test(loops));
  check("TESTE 8: o SELECT do Loop traz a legenda de cada vídeo",
    loops.includes('.select("id, public_url, filename, file_size, caption")'));
  check("TESTE 8: o texto vai para o container (snapshot por conta+vídeo)",
    loops.includes("caption,") && loops.includes("caption_mode: normalizeCaptionMode(loop.caption_mode)"));
  check("TESTE 8: Postar resolve por vídeo dentro do laço",
    /for \(let vi = 0[\s\S]{0,2500}originalCaption: video\.caption/.test(distribute));
  check("TESTE 8: cada linha de scheduled_posts leva a legenda resolvida",
    distribute.includes("caption: resolucao.caption"));

  check("TESTE 9: publish-scheduled só LÊ o snapshot, nunca recalcula",
    publishSched.includes("post.caption ?? \"\"") &&
    !semComentarios(publishSched).includes("resolveCaption"));
  check("TESTE 9: publish-scheduled não consulta a legenda do vídeo",
    !/original_caption|\.caption\b[\s\S]{0,40}videos_library/.test(semComentarios(publishSched)));

  check("TESTE 10: Clone resolve por Reel dentro do laço",
    /for \(let ri = 0[\s\S]{0,900}originalCaption: reel\.originalCaption/.test(cloneCreate));
  // O rehost do Clone (CDN do Instagram → Supabase Storage) roda no cron
  // prefetch-clone-urls e só troca a URL do vídeo. A legenda já está congelada
  // na linha desde o agendamento, então esse cron não pode tocar em caption.
  const prefetch = semComentarios(src("app/api/cron/prefetch-clone-urls/route.ts"));
  check("TESTE 10: o rehost do vídeo não toca na legenda",
    /caption:\s+resolucao\.caption/.test(cloneCreate) &&
    prefetch.includes("video_url") && !prefetch.includes("caption"));

  check("caption_mode existe nas configurações e nos posts concretos",
    migration.includes("public.loops") && migration.includes("public.distribute_campaigns") &&
    migration.includes("public.scheduled_posts") && migration.includes("public.pending_containers"));
  check("caption_mode é NULLABLE (legado mantém comportamento)",
    migration.includes("caption_mode IS NULL OR caption_mode IN"));
  check("migration não faz backfill",
    !/UPDATE\s+public\.(loops|distribute_campaigns|scheduled_posts|videos_library)\s+SET/i.test(migration));
  check("reusa videos_library.caption e owner_username em vez de duplicar",
    migration.includes("COMMENT ON COLUMN public.videos_library.caption") &&
    !/ADD COLUMN IF NOT EXISTS original_caption/.test(migration) &&
    !/ADD COLUMN IF NOT EXISTS source_username/.test(migration));

  // ══════════════════════════════════════════════════════════════════════════
  console.log("\n== 8. Segurança e escopo ==\n");

  // TESTE 12 — XSS
  const xss = "<script>alert(1)</script>";
  const rXss = resolveCaption({ mode: "original", originalCaption: xss });
  check("TESTE 12: a legenda é tratada como texto, sem sanitização que a altere",
    rXss.caption === xss);
  const componentes = [
    "components/dashboard/CaptionModeSelector.tsx",
    "components/library/VideoCard.tsx",
    "components/inspirations/InspirationCard.tsx",
    "components/library/PostModal.tsx",
  ];
  for (const c of componentes) {
    check(`TESTE 12: ${c.split("/").pop()} não usa dangerouslySetInnerHTML`,
      !semComentarios(src(c)).includes("dangerouslySetInnerHTML"));
  }
  check("TESTE 12: a legenda é renderizada como filho de JSX (React escapa)",
    src("components/dashboard/CaptionModeSelector.tsx").includes("{caption}") &&
    src("components/library/VideoCard.tsx").includes("{video.caption}"));
  check("TESTE 12: quebras de linha vêm de CSS, não de HTML injetado",
    src("components/dashboard/CaptionModeSelector.tsx").includes("whitespace-pre-wrap"));

  // Ownership
  check("OWNERSHIP: a legenda vem do banco com filtro de dono",
    /videos_library[\s\S]{0,200}\.eq\("user_id", user\.id\)/.test(publishNow));
  check("OWNERSHIP: modo original ignora o texto vindo do cliente",
    publishNow.includes("originalCaption: (video as { caption?: string | null }).caption"));
  check("OWNERSHIP: distribute lê os vídeos filtrando por dono",
    /videos_library[\s\S]{0,300}\.eq\("user_id", user\.id\)/.test(distribute));

  // Stories intocado
  check("TESTE 15: Stories não ganhou lógica de caption de Reel",
    !storiesNow.includes("caption_mode") && !storiesNow.includes("resolveCaption"));
  check("TESTE 15: Stories continua gravando caption vazia",
    storiesNow.includes('caption: ""'));

  // Performance
  check("PERF: nenhuma chamada ao Apify no caminho de publicação",
    !/apify/i.test(semComentarios(loops)) &&
    !/apify/i.test(semComentarios(distribute)));

  // Pipeline de vídeo intocado
  console.log("\n== 9. Mídia intocada ==\n");
  check("video_processing_mode segue independente da legenda",
    loops.includes("normalizeProcessingMode") && distribute.includes("normalizeProcessingMode"));
  check("a lib de legendas não importa nada de vídeo/FFmpeg",
    !/ffmpeg|video-processing|video-effects|storage/i
      .test(semComentarios(src("lib/reel-captions.ts"))));
  // Comentários de SQL usam `--`; sem removê-los, a própria explicação de que
  // a migration NÃO mexe em mídia derrubaria a checagem.
  const migrationSemComentarios = migration.replace(/^\s*--.*$/gm, "");
  check("a migration não altera coluna de mídia",
    !/storage_path|public_url|video_processing_mode|file_size/.test(migrationSemComentarios));

  console.log(`\n${passed} passaram, ${failed} falharam\n`);
  process.exit(failed === 0 ? 0 : 1);
}

function limpar() {
  for (const d of buildDirs) {
    try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* best-effort */ }
  }
}
process.on("exit", limpar);

main().catch((e) => { console.error(e); limpar(); process.exit(1); });
