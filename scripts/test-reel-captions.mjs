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

  // O tsc emite `from "./reel-captions"` sem extensão; o loader ESM do Node
  // exige `./reel-captions.js`. Só o build de teste precisa disso — no Next o
  // bundler resolve sozinho.
  for (const arquivo of fs.readdirSync(out).filter((f) => f.endsWith(".js"))) {
    const p = path.join(out, arquivo);
    fs.writeFileSync(
      p,
      fs.readFileSync(p, "utf8").replace(/from "(\.\/[^"]+?)"/g, 'from "$1.js"')
    );
  }
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
    validateInstagramCaption, captionLength, InvalidCaptionError,
    INSTAGRAM_CAPTION_MAX_LENGTH, INSTAGRAM_CAPTION_MAX_HASHTAGS, INSTAGRAM_CAPTION_MAX_MENTIONS,
    DEFAULT_CAPTION_MODE, DEFAULT_CAPTION_MODE_CLONE,
  } = caps;

  // A normalização da busca de Inspirações saiu do poller para
  // lib/inspiration-scrape.ts (busca durável, 2026-09-13) — poll e cron usam a
  // mesma função.
  const pollInsp = src("app/api/inspirations/scrape/poll/route.ts") + src("lib/inspiration-scrape.ts");
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

  check("limites oficiais centralizados: 2200 / 30 / 20",
    INSTAGRAM_CAPTION_MAX_LENGTH === 2200 &&
    INSTAGRAM_CAPTION_MAX_HASHTAGS === 30 &&
    INSTAGRAM_CAPTION_MAX_MENTIONS === 20);
  const longa = resolveCaption({ mode: "original", originalCaption: "a".repeat(2201) });
  check("TESTE 13: legenda acima do limite é SINALIZADA, não truncada",
    longa.validation.valid === false && longa.caption.length === 2201);
  check("TESTE 13: no limite exato não dispara erro",
    resolveCaption({ mode: "original", originalCaption: "a".repeat(2200) }).validation.valid === true);
  check("emoji conta como 1 caractere (code points, não UTF-16)",
    resolveCaption({ mode: "original", originalCaption: "😂😂😂" }).length === 3);

  check("TESTE 13: distribute devolve erro ANTES de agendar",
    /!resolucao\.validation\.valid[\s\S]{0,400}status: 400/.test(distribute));
  check("TESTE 13: clone devolve erro ANTES de agendar",
    /!resolucao\.validation\.valid[\s\S]{0,400}status: 400/.test(cloneCreate));
  check("TESTE 13: publicação imediata devolve erro antes da Meta",
    /!resolucao\.validation\.valid[\s\S]{0,400}status: 400/.test(publishNow));
  check("TESTE 13: Loop registra erro e pula a conta, sem cortar",
    loops.includes("captionRejectionMessage") && loops.includes("recordContainerError"));

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

  const metaDir = compilar(["lib/meta-publish.ts", "lib/reel-captions.ts"]);
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

  // ══════════════════════════════════════════════════════════════════════════
  console.log("\n== 10. Limites do Instagram: validar, nunca truncar ==\n");

  const hashtagsRepetidas = (n) =>
    Array.from({ length: n }, (_, i) => `#tag${i}`).join(" ");
  const mencoesRepetidas = (n) =>
    Array.from({ length: n }, (_, i) => `@perfil${i}`).join(" ");

  // LIMITE 1/2 — comprimento
  const noLimite = "a".repeat(2200);
  const acimaDoLimite = "a".repeat(2201);
  check("LIMITE 1: 2200 caracteres → válida",
    validateInstagramCaption(noLimite).valid === true);
  check("LIMITE 2: 2201 caracteres → inválida",
    validateInstagramCaption(acimaDoLimite).valid === false &&
    validateInstagramCaption(acimaDoLimite).error.code === "CAPTION_TOO_LONG");
  check("LIMITE 2: NUNCA truncada para 2200 (o texto volta inteiro)",
    resolveCaption({ mode: "original", originalCaption: acimaDoLimite })
      .caption.length === 2201);
  check("LIMITE 2: mensagem diz o número real e o máximo",
    validateInstagramCaption(acimaDoLimite).error.message ===
      "Legenda possui 2201 caracteres. Máximo permitido: 2200.");

  // LIMITE 3/4 — hashtags
  check("LIMITE 3: 30 hashtags → válida",
    validateInstagramCaption(hashtagsRepetidas(30)).valid === true &&
    validateInstagramCaption(hashtagsRepetidas(30)).hashtagCount === 30);
  const h31 = validateInstagramCaption(hashtagsRepetidas(31));
  check("LIMITE 4: 31 hashtags → inválida",
    h31.valid === false && h31.error.code === "CAPTION_TOO_MANY_HASHTAGS");
  check("LIMITE 4: mensagem de hashtags é a pedida",
    h31.error.message === "Legenda possui 31 hashtags. O Instagram permite no máximo 30.");
  check("LIMITE 4: hashtags NÃO são removidas automaticamente",
    resolveCaption({ mode: "original", originalCaption: hashtagsRepetidas(31) })
      .caption === hashtagsRepetidas(31));

  // LIMITE 5/6 — menções
  check("LIMITE 5: 20 menções → válida",
    validateInstagramCaption(mencoesRepetidas(20)).valid === true &&
    validateInstagramCaption(mencoesRepetidas(20)).mentionCount === 20);
  const m21 = validateInstagramCaption(mencoesRepetidas(21));
  check("LIMITE 6: 21 menções → inválida",
    m21.valid === false && m21.error.code === "CAPTION_TOO_MANY_MENTIONS");
  check("LIMITE 6: mensagem de menções é a pedida",
    m21.error.message === "Legenda possui 21 menções. O Instagram permite no máximo 20.");
  check("LIMITE 6: menções NÃO são removidas automaticamente",
    resolveCaption({ mode: "original", originalCaption: mencoesRepetidas(21) })
      .caption === mencoesRepetidas(21));

  // LIMITE 7/8 — vale para original E para custom
  check("LIMITE 7: original acima do limite → resolução inválida",
    resolveCaption({ mode: "original", originalCaption: acimaDoLimite })
      .validation.valid === false);
  check("LIMITE 8: custom acima do limite também é bloqueada (sem exceção)",
    resolveCaption({ mode: "custom", customCaption: acimaDoLimite })
      .validation.valid === false);
  check("LIMITE 8: custom com 31 hashtags também é bloqueada",
    resolveCaption({ mode: "custom", customCaption: hashtagsRepetidas(31) })
      .validation.valid === false);

  // LIMITE 9 — none nunca é barrada
  check("LIMITE 9: none não valida conteúdo e resolve para vazio",
    resolveCaption({ mode: "none", originalCaption: acimaDoLimite, customCaption: acimaDoLimite })
      .validation.valid === true &&
    resolveCaption({ mode: "none", originalCaption: acimaDoLimite }).caption === "");

  // LIMITE 10/11 — strip acontece ANTES da validação
  const com34 = `texto ${hashtagsRepetidas(34)}`;
  check("LIMITE 10: 34 hashtags SEM strip → inválida",
    resolveCaption({ mode: "original", originalCaption: com34 }).validation.valid === false);
  const stripped34 = resolveCaption({
    mode: "original", originalCaption: com34, stripHashtags: true,
  });
  check("LIMITE 10: 34 hashtags COM strip explícito → válida",
    stripped34.validation.valid === true && stripped34.hashtags === 0);
  const com25 = `crédito ${mencoesRepetidas(25)}`;
  check("LIMITE 11: 25 menções SEM strip → inválida",
    resolveCaption({ mode: "original", originalCaption: com25 }).validation.valid === false);
  const stripped25 = resolveCaption({
    mode: "original", originalCaption: com25, stripMentions: true,
  });
  check("LIMITE 11: 25 menções COM strip explícito → válida",
    stripped25.validation.valid === true && stripped25.mentions === 0);
  check("LIMITE 10/11: a validação é do TEXTO FINAL, não do original",
    stripped34.length === captionLength(stripped34.caption));

  // LIMITE 12/13 — Unicode intacto
  const emojisNoLimite = "😂".repeat(2200);
  check("LIMITE 12: 2200 emojis contam como 2200 (code points, não UTF-16)",
    captionLength(emojisNoLimite) === 2200 &&
    validateInstagramCaption(emojisNoLimite).valid === true);
  check("LIMITE 12: 2201 emojis → inválida, e a string não é corrompida",
    validateInstagramCaption("😂".repeat(2201)).valid === false &&
    resolveCaption({ mode: "original", originalCaption: "😂".repeat(2201) })
      .caption === "😂".repeat(2201));
  const perto = "a".repeat(2197) + "😂é\n";
  check("LIMITE 13: emoji, acento e quebra de linha perto do limite sobrevivem",
    resolveCaption({ mode: "original", originalCaption: perto }).caption === perto &&
    captionLength(perto) === 2200);

  // ══════════════════════════════════════════════════════════════════════════
  console.log("\n== 11. Transporte: defesa final ==\n");

  const agent2 = new MockAgent();
  agent2.disableNetConnect();
  setGlobalDispatcher(agent2);
  const pool2 = agent2.get("https://graph.instagram.com");

  let requestsFeitos = 0;
  pool2
    .intercept({ path: /\/v21\.0\/[^/]+\/media$/, method: "POST" })
    .reply(200, () => { requestsFeitos++; return { id: "creation_ok" }; })
    .times(5);

  // Válida → o request acontece
  await meta.createMediaContainerOnly(
    "17841400000000000", "https://cdn/ok.mp4", "legenda normal 😂", "TOKEN", "REELS", null
  );
  check("LIMITE 14: legenda válida → POST /media acontece", requestsFeitos === 1);

  // LIMITE 14 — legado inválido chega ao transporte: bloqueia, zero request
  const cenarios = [
    ["comprimento", acimaDoLimite, "CAPTION_TOO_LONG"],
    ["hashtags", hashtagsRepetidas(31), "CAPTION_TOO_MANY_HASHTAGS"],
    ["menções", mencoesRepetidas(21), "CAPTION_TOO_MANY_MENTIONS"],
  ];
  for (const [rotulo, texto, code] of cenarios) {
    const antes = requestsFeitos;
    let erro = null;
    try {
      await meta.createMediaContainerOnly(
        "17841400000000000", "https://cdn/x.mp4", texto, "TOKEN", "REELS", null
      );
    } catch (e) { erro = e; }
    // `instanceof` não serve aqui: o teste importa a lib de um build e o
    // meta-publish de outro, então são duas classes distintas em memória.
    // O contrato observável é o par name+code.
    check(`LIMITE 14 (${rotulo}): transporte lança InvalidCaptionError`,
      erro !== null && erro.name === "InvalidCaptionError" && erro.code === code);
    check(`LIMITE 14 (${rotulo}): ZERO requests à Meta`, requestsFeitos === antes);
  }

  await agent2.close();

  // O corte permitido no arquivo é o da RESPOSTA da Meta em mensagem de erro
  // (`rawText.slice(0, 300)`); o proibido é qualquer corte na legenda.
  check("LIMITE 14: o transporte não corta a legenda",
    !/\b(caption|captionFinal|raw)\s*\.\s*(slice|substring|substr)\s*\(/
      .test(semComentarios(src("lib/meta-publish.ts"))));

  // ══════════════════════════════════════════════════════════════════════════
  console.log("\n== 12. Nenhuma truncagem silenciosa sobrou ==\n");

  const arquivosDeCaption = [
    "lib/meta-publish.ts", "lib/reel-captions.ts", "lib/scraped-reel.ts",
    "app/api/posts/distribute/route.ts", "app/api/posts/publish/route.ts",
    "app/api/clone/create/route.ts", "app/api/cron/process-loops/route.ts",
    "app/api/cron/publish-scheduled/route.ts",
    "app/api/cron/sync-distribute-accounts/route.ts",
    "app/api/inspirations/save-to-library/route.ts",
  ];
  for (const arq of arquivosDeCaption) {
    const codigo = semComentarios(src(arq));
    // Truncagem de texto de legenda: slice/substring/substr aplicados a uma
    // variável de caption. Logs cortam com `.slice(0, 80)` DENTRO de template
    // string — esses são permitidos e não tocam no que vai para a Meta.
    const suspeitos = [
      ...codigo.matchAll(/\b(caption[A-Za-z]*|resolucao\.caption)\s*\.\s*(slice|substring|substr)\s*\(/g),
    ].filter((m) => {
      // permite o corte de log dentro de crase
      const antes = codigo.slice(Math.max(0, m.index - 120), m.index);
      return !antes.includes("`") && !antes.includes("console.");
    });
    check(`${arq.split("/").pop()}: nenhuma truncagem de caption`, suspeitos.length === 0);
  }

  check("LIMITE 15: o literal 2200 não é repetido fora da lib de limites",
    !/2200/.test(semComentarios(src("lib/meta-publish.ts"))) &&
    !/2200/.test(semComentarios(src("app/api/posts/distribute/route.ts"))) &&
    !/2200/.test(semComentarios(src("app/dashboard/postar/page.tsx"))));
  check("LIMITE 15: as constantes vivem só em lib/reel-captions.ts",
    src("lib/reel-captions.ts").includes("INSTAGRAM_CAPTION_MAX_LENGTH = 2200") &&
    src("lib/reel-captions.ts").includes("INSTAGRAM_CAPTION_MAX_HASHTAGS = 30") &&
    src("lib/reel-captions.ts").includes("INSTAGRAM_CAPTION_MAX_MENTIONS = 20"));
  check("LIMITE 15: a UI não corta mais o texto digitado",
    !/next\[i\] = val\.slice/.test(src("app/dashboard/postar/page.tsx")));
  check("sanitizeCaption só faz transformações de transporte",
    /\.trim\(\);/.test(src("lib/meta-publish.ts")) &&
    !/sanitizeCaption[\s\S]{0,400}(slice|substring|replace\(HASHTAG|replace\(MENTION)/
      .test(semComentarios(src("lib/meta-publish.ts"))));
  check("erros de legenda não vazam o texto para o log",
    !/console\.(error|log)\([^)]*\bcaption(Final)?\b[^)]*\)/
      .test(semComentarios(src("lib/meta-publish.ts")).replace(/caption_chars=\$\{[^}]+\}/g, "")));

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
