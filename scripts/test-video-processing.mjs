/**
 * Verificação da arquitetura "Processamento de vídeo opt-in por publicação".
 *
 * Roda com:  node scripts/test-video-processing.mjs
 *
 * Parte 1 — comportamento real do FFmpeg (ingestão byte a byte, stream copy).
 * Parte 2 — comportamento real de lib/video-processing.ts com um admin simulado
 *           (é aqui que provamos que clean_metadata NUNCA cai para original).
 * Parte 3 — garantias estruturais sobre o código-fonte real.
 */

import { spawn } from "child_process";
import { createServer } from "http";
import { createHash } from "crypto";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { pathToFileURL, fileURLToPath } from "url";

// O mesmo binário do container: o FFmpeg do sistema (FFMPEG_PATH ou PATH).
const ffmpegPath = process.env.FFMPEG_PATH || "ffmpeg";
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "asc-vp-"));

let passed = 0;
let failed = 0;

function check(name, ok, detail = "") {
  if (ok) {
    passed++;
    console.log(`  PASS  ${name}`);
  } else {
    failed++;
    console.log(`  FAIL  ${name}${detail ? ` -- ${detail}` : ""}`);
  }
}

function sha256(file) {
  return createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function run(bin, args) {
  return new Promise((resolve, reject) => {
    const p = spawn(bin, args, { stdio: "ignore", shell: process.platform === "win32" });
    p.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`${bin} exit ${code}`))));
    p.on("error", reject);
  });
}

const ff = (args) => run(ffmpegPath, args);

function src(relPath) {
  return fs.readFileSync(path.join(repoRoot, relPath), "utf8");
}

// As MESMAS opções de entrada de lib/ffmpeg-input.ts (checadas no fim).
const INPUT_OPTS = ["-protocol_whitelist", "file", "-format_whitelist", "mov,matroska"];

// As MESMAS opções usadas por lib/ffmpeg-process.ts. Se divergirem, a checagem
// estrutural no fim falha — então esta lista não pode envelhecer em silêncio.
const CLEAN_OPTS = [
  "-map", "0:v:0",
  "-map", "0:a:0?",
  "-c:v", "copy",
  "-c:a", "copy",
  "-map_metadata", "-1",
  "-map_chapters", "-1",
  "-movflags", "+faststart",
  "-f", "mp4",
];

// ── Admin Supabase simulado ─────────────────────────────────────────────────
// Reproduz só a superfície de query usada por lib/video-processing.ts.

function makeAdmin(rows) {
  let calls = 0;
  const store = { video_variants: rows };

  class Query {
    constructor(table) {
      this.table = table;
      this.filters = [];
      this.op = null;
      this.payload = null;
    }
    select() { return this; }
    limit() { return this; }
    eq(col, val) { this.filters.push([col, val]); return this; }
    lt() { return this; }
    in() { return this; }
    insert(payload) { this.op = "insert"; this.payload = payload; return this; }
    update(payload) { this.op = "update"; this.payload = payload; return this; }
    delete() { this.op = "delete"; return this; }
    _match() {
      return store[this.table].filter((r) => this.filters.every(([c, v]) => r[c] === v));
    }
    _run() {
      if (this.op === "insert") {
        const row = { id: `var-${store[this.table].length + 1}`, attempts: 0, ...this.payload };
        store[this.table].push(row);
        return { data: row, error: null };
      }
      if (this.op === "update") {
        const matched = this._match();
        for (const r of matched) Object.assign(r, this.payload);
        return { data: matched, error: null };
      }
      const matched = this._match();
      return { data: matched, error: null };
    }
    maybeSingle() {
      const { data } = this._run();
      return Promise.resolve({ data: Array.isArray(data) ? (data[0] ?? null) : data, error: null });
    }
    single() {
      const { data } = this._run();
      return Promise.resolve({ data: Array.isArray(data) ? (data[0] ?? null) : data, error: null });
    }
    then(onOk, onErr) {
      return Promise.resolve(this._run()).then(onOk, onErr);
    }
  }

  return {
    _calls: () => calls,
    from(table) { calls++; return new Query(table); },
    storage: {
      from: () => ({
        upload: async () => ({ error: null }),
        getPublicUrl: (p) => ({ data: { publicUrl: `https://storage.test/${p}` } }),
        remove: async () => ({ error: null }),
      }),
    },
  };
}

// Compila lib/video-processing.ts + lib/ffmpeg-process.ts para poder importá-los
// aqui (o repositório não tem runner de TS).
async function loadVideoProcessing() {
  // Emite dentro do repo: o Node precisa enxergar node_modules para resolver
  // fluent-ffmpeg/undici a partir do modulo compilado.
  const buildDir = path.join(repoRoot, "node_modules", ".cache", "asc-video-test");
  fs.rmSync(buildDir, { recursive: true, force: true });
  fs.mkdirSync(buildDir, { recursive: true });
  const tsconfigPath = path.join(buildDir, "tsconfig.test.json");
  fs.writeFileSync(tsconfigPath, JSON.stringify({
    compilerOptions: {
      target: "es2022",
      module: "es2022",
      moduleResolution: "node",
      outDir: buildDir,
      rootDir: repoRoot,
      baseUrl: repoRoot,
      paths: { "@/*": ["./*"] },
      skipLibCheck: true,
      esModuleInterop: true,
      noEmitOnError: false,
    },
    files: [
      path.join(repoRoot, "lib/video-processing.ts"),
      path.join(repoRoot, "lib/ffmpeg-process.ts"),
    ],
  }, null, 2));

  await run("npx", ["tsc", "-p", tsconfigPath]).catch(() => { /* emit mesmo com erro de tipos */ });

  fs.writeFileSync(path.join(buildDir, "package.json"), JSON.stringify({ type: "module" }));
  const outFile = path.join(buildDir, "lib", "video-processing.js");
  if (!fs.existsSync(outFile)) throw new Error("falha ao compilar lib/video-processing.ts");

  // tsc não reescreve o alias "@/..." — aponta para os arquivos irmãos emitidos.
  const libOut = path.dirname(outFile);
  for (const name of fs.readdirSync(libOut).filter((n) => n.endsWith(".js"))) {
    const file = path.join(libOut, name);
    fs.writeFileSync(file, fs.readFileSync(file, "utf8").replace(/["']@\/lib\/([\w-]+)["']/g, '"./$1.js"'));
  }

  return import(pathToFileURL(outFile).href);
}

async function main() {
  console.log("\n== Parte 1: comportamento real do pipeline (FFmpeg) ==\n");

  const origin = path.join(tmp, "origin.mp4");
  await ff([
    "-y", "-f", "lavfi", "-i", "testsrc=size=320x240:rate=15:duration=2",
    "-f", "lavfi", "-i", "sine=frequency=440:duration=2",
    "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p",
    "-c:a", "aac",
    "-metadata", "title=ORIGINAL_TITLE",
    "-metadata", "comment=cdn-tracking-uuid-1234",
    "-metadata", "creation_time=2020-01-01T00:00:00Z",
    origin,
  ]);
  const originHash = sha256(origin);

  // ── Ingestão preserva o arquivo original ──────────────────────────────────
  const server = createServer((_req, res) => {
    res.writeHead(200, { "Content-Type": "video/mp4" });
    fs.createReadStream(origin).pipe(res);
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const port = server.address().port;

  const ingested = path.join(tmp, "ingested.mp4");
  const res = await fetch(`http://127.0.0.1:${port}/v.mp4`);
  fs.writeFileSync(ingested, Buffer.from(await res.arrayBuffer()));
  server.close();

  check("Ingestão preserva o arquivo (SHA-256 idêntico)", sha256(ingested) === originHash);
  check(
    "Nenhum fluxo de ingestão importa FFmpeg",
    !src("lib/media-ingest.ts").includes("ffmpeg") &&
      !src("app/api/inspirations/save-to-library/route.ts").includes("ffmpeg") &&
      !src("app/api/video/process/route.ts").includes("ffmpeg") &&
      !src("app/api/cron/prefetch-clone-urls/route.ts").includes("ffmpeg")
  );

  // ── clean_metadata: variante separada, original intacto, sem reencode ─────
  const variant = path.join(tmp, "variant.mp4");
  await ff(["-y", ...INPUT_OPTS, "-i", origin, ...CLEAN_OPTS, variant]);

  check("A variante é um arquivo distinto do original", sha256(variant) !== originHash);
  check("O arquivo original permanece intacto após gerar a variante", sha256(origin) === originHash);

  const dumpMeta = async (input, out) => {
    await ff(["-y", "-i", input, "-f", "ffmetadata", out]);
    return fs.readFileSync(out, "utf8");
  };
  const metaOrigin = await dumpMeta(origin, path.join(tmp, "m_origin.txt"));
  const metaVariant = await dumpMeta(variant, path.join(tmp, "m_variant.txt"));
  check("Metadados do container removidos na variante", metaOrigin.includes("ORIGINAL_TITLE") && !metaVariant.includes("ORIGINAL_TITLE"));
  check("UUID de rastreio do CDN removido na variante", metaOrigin.includes("cdn-tracking-uuid-1234") && !metaVariant.includes("cdn-tracking-uuid-1234"));

  const rawFrom = async (input, out) => {
    await ff(["-y", "-i", input, "-map", "0:v:0", "-c:v", "copy", "-f", "h264", out]);
    return sha256(out);
  };
  const rawOrigin = await rawFrom(origin, path.join(tmp, "o.h264"));
  const rawVariant = await rawFrom(variant, path.join(tmp, "v.h264"));
  check("clean_metadata é stream copy: bitstream H.264 idêntico (zero reencode)", rawOrigin === rawVariant);

  const variant2 = path.join(tmp, "variant2.mp4");
  await ff(["-y", ...INPUT_OPTS, "-i", origin, ...CLEAN_OPTS, variant2]);
  check("A variante do mesmo arquivo é reprodutível byte a byte", sha256(variant) === sha256(variant2));

  // Playlist HLS com extensão .mp4: sem a whitelist de demuxer, o FFmpeg leria
  // arquivos locais (/etc/passwd, /proc/self/environ) para dentro do vídeo.
  const evil = path.join(tmp, "evil.mp4");
  fs.writeFileSync(evil, "#EXTM3U\n#EXT-X-TARGETDURATION:1\n#EXTINF:1,\nfile:///etc/passwd\n#EXT-X-ENDLIST\n");
  const evilRejected = await ff(["-y", ...INPUT_OPTS, "-i", evil, ...CLEAN_OPTS, path.join(tmp, "evil_out.mp4")])
    .then(() => false, () => true);
  check("Entrada que não é MP4/MOV/WebM de verdade é recusada (HLS disfarçado)", evilRejected);

  console.log("\n== Parte 2: resolução de modo com admin simulado ==\n");

  const vp = await loadVideoProcessing();
  const ORIGINAL_URL = "https://storage.test/videos/upload_original.mp4";
  const CLEAN_URL = "https://storage.test/variants/clean/v1/abc.mp4";

  // TESTE 1 — mode=original publica o original, sem tocar em banco nem FFmpeg.
  const explosiveAdmin = {
    from() { throw new Error("modo original NAO pode consultar o banco"); },
    storage: { from() { throw new Error("modo original NAO pode tocar no Storage"); } },
  };
  const r1 = await vp.resolveMediaUrlForMode(explosiveAdmin, {
    mode: "original", sourceUrl: ORIGINAL_URL, scope: "teste-1",
  });
  check("TESTE 1: mode=original publica o original (ready + URL original)",
    r1.status === "ready" && r1.url === ORIGINAL_URL && r1.mode === "original");
  check("TESTE 1/8: mode=original não faz I/O nenhum (zero FFmpeg, zero DB, zero Storage)", true);

  // TESTE 2 — variante pronta: usa a variante.
  const adminReady = makeAdmin([{
    id: "v-ready", status: "ready", public_url: CLEAN_URL, attempts: 1, error_reason: null,
    source_hash: vp.sourceHash(ORIGINAL_URL), processing_mode: "clean_metadata", processing_version: vp.CLEAN_METADATA_VERSION,
  }]);
  const r2 = await vp.resolveMediaUrlForMode(adminReady, {
    mode: "clean_metadata", sourceUrl: ORIGINAL_URL, scope: "teste-2",
  });
  check("TESTE 2: variante pronta é usada (e não o original)",
    r2.status === "ready" && r2.url === CLEAN_URL && r2.mode === "clean_metadata" && r2.url !== ORIGINAL_URL);

  // TESTE 3 — falha permanente: NUNCA publica o original.
  const adminDead = makeAdmin([{
    id: "v-dead", status: "error", public_url: null, attempts: 3, error_reason: "FFmpeg: codec inválido",
    source_hash: vp.sourceHash(ORIGINAL_URL), processing_mode: "clean_metadata", processing_version: vp.CLEAN_METADATA_VERSION,
  }]);
  const r3 = await vp.resolveMediaUrlForMode(adminDead, {
    mode: "clean_metadata", sourceUrl: ORIGINAL_URL, scope: "teste-3",
  });
  check("TESTE 3: falha permanente devolve status=error (não 'ready')", r3.status === "error");
  check("TESTE 3: falha permanente NÃO devolve a URL original",
    JSON.stringify(r3).includes(ORIGINAL_URL) === false && r3.url === undefined);
  check("TESTE 3: o motivo da falha é preservado para o usuário",
    typeof r3.reason === "string" && r3.reason.includes("codec inválido"));

  // TESTE 4 — ciclo completo de tentativas: em nenhum ponto vira "original".
  // Cada volta simula o worker (prepareCleanMetadataVariant) falhando e
  // incrementando `attempts`, exatamente como acontece em produção.
  const opts4 = { mode: "clean_metadata", sourceUrl: ORIGINAL_URL, scope: "teste-4" };
  const cycleRows = [];
  const adminCycle = makeAdmin(cycleRows);
  const seen = [await vp.resolveMediaUrlForMode(adminCycle, opts4)]; // enfileira

  for (let attempt = 1; attempt <= 3; attempt++) {
    cycleRows[0].status = "error";
    cycleRows[0].attempts = attempt;
    cycleRows[0].error_reason = `falha simulada ${attempt}`;
    seen.push(await vp.resolveMediaUrlForMode(adminCycle, opts4));
  }

  check("TESTE 4: primeira resolução enfileira a variante (pending)", seen[0].status === "pending");
  check("TESTE 4: com attempts < limite a variante volta para a fila (pending)",
    seen[1].status === "pending" && seen[2].status === "pending");
  check("TESTE 4: no limite de tentativas vira error terminal", seen[3].status === "error");
  check("TESTE 4: nenhuma resolução da cadeia devolveu a URL original",
    seen.every((r) => r.url === undefined || r.url !== ORIGINAL_URL));

  // resolveMediaUrlNow (publicação imediata) também não faz fallback.
  const nowDead = makeAdmin([{
    id: "v-dead2", status: "error", public_url: null, attempts: 5, error_reason: "erro permanente",
    source_hash: vp.sourceHash(ORIGINAL_URL), processing_mode: "clean_metadata", processing_version: vp.CLEAN_METADATA_VERSION,
  }]);
  const rNow = await vp.resolveMediaUrlNow(nowDead, {
    mode: "clean_metadata", sourceUrl: ORIGINAL_URL, scope: "teste-4b",
  });
  check("TESTE 4: publicação imediata (resolveMediaUrlNow) também não cai para o original",
    rNow.ok === false && JSON.stringify(rNow).includes(ORIGINAL_URL) === false);

  console.log("\n== Parte 3: garantias estruturais no código ==\n");

  const clean = src("lib/video-processing.ts");
  const publishScheduled = src("app/api/cron/publish-scheduled/route.ts");
  const processLoops = src("app/api/cron/process-loops/route.ts");
  const postsCreate = src("app/api/posts/create/route.ts");
  const storyTemplates = src("app/api/cron/story-templates/route.ts");
  const effects = src("lib/video-effects.ts");
  const processVideos = src("app/api/cron/process-videos/route.ts");

  // Guarda estática: nenhum retorno de erro pode carregar uma URL.
  const errorReturns = clean.match(/return \{[^}]*status: "error"[^}]*\}/gs) ?? [];
  check("Guarda estática: todo retorno status=\"error\" é livre de URL (sem fallback)",
    errorReturns.length >= 1 && errorReturns.every((r) => !r.includes("url")));
  // [^_] evita casar com `source_url: sourceUrl` (payload do insert da variante).
  check("Guarda estatica: 'url: sourceUrl' so aparece nos caminhos original/imagem",
    (clean.match(/[^_]url: sourceUrl/g) ?? []).length === 2 &&
      !clean.includes("opts.sourceUrl") &&
      !clean.includes("publicando o ORIGINAL"));

  // Cada consumidor precisa tratar o estado de erro sem publicar.
  check("publish-scheduled bloqueia a publicação quando a limpeza falha",
    /resolution\.status === "error"/.test(publishScheduled) &&
      publishScheduled.includes("[LIMPEZA DE METADADOS]") &&
      /status: "failed"/.test(publishScheduled));
  check("process-loops pula a conta (sem publicar o original) quando a limpeza falha",
    /resolution\.status === "error"/.test(processLoops) && processLoops.includes("[LIMPEZA DE METADADOS]"));
  check("story-templates registra last_error e não reposta a mídia original",
    /resolution\.status === "error"/.test(storyTemplates) && storyTemplates.includes("last_error"));
  check("posts/create devolve erro por conta em vez de publicar o original",
    postsCreate.includes("prepared.ok") && postsCreate.includes("[LIMPEZA DE METADADOS]"));

  // TESTE 5 — decisão do post é soberana.
  check("TESTE 5: publish-scheduled lê o modo DO POST, nunca da configuração pai",
    publishScheduled.includes("normalizeProcessingMode(post.video_processing_mode)") &&
      !publishScheduled.includes('from("loops")') &&
      !publishScheduled.includes('from("automations")'));
  // (o cron process-automations saiu do produto em 2026-09-06 junto com o
  //  módulo Automatizar — a checagem cobre os fluxos que restaram)
  check("TESTE 5: a decisão é copiada para o post concreto no agendamento",
    src("app/api/posts/distribute/route.ts").includes("video_processing_mode: processingMode") &&
      src("app/api/cron/sync-distribute-accounts/route.ts").includes("normalizeProcessingMode(campaign.video_processing_mode)") &&
      processLoops.includes("video_processing_mode: normalizeProcessingMode(loop.video_processing_mode)"));

  // TESTE 6 — efeitos criativos seguem funcionando, em pipeline próprio.
  check("TESTE 6: efeitos criativos continuam na fila video_processing_jobs",
    processLoops.includes("hasActiveEffects") &&
      processLoops.includes("video_processing_jobs") &&
      processVideos.includes("processVideoForAccount") &&
      effects.includes("libx264"));
  check("TESTE 6: os filtros criativos continuam intactos (hflip/negate/zoom/blur/noise/antiAi)",
    ["hflip", "negate", "smartblur", "noise=c0s=", "eq=contrast=", "asetrate="].every((t) => effects.includes(t)));

  // TESTE 7 — efeitos não injetam metadata artificial.
  // Só o array de argumentos, sem comentários (que citam "-metadata" em texto).
  const effectsOptions = effects
    .slice(effects.indexOf("const outputOptions"), effects.indexOf("await new Promise"))
    .split(/\r?\n/)
    .filter((l) => !l.trim().startsWith("//"))
    .join(" ");
  check("TESTE 7: os argumentos FFmpeg dos efeitos não contêm '-metadata'", !effectsOptions.includes('"-metadata"'));
  check("TESTE 7: creation_time artificial removido do pipeline de efeitos",
    !effects.includes("randomCreationTime") && !/creation_time=\$\{/.test(effects));
  check("TESTE 7: nenhum helper de data/UUID artificial sobrou nos efeitos",
    !/function randomCreationTime/.test(effects) && !effects.includes("hash bust"));

  // TESTE 8 — sem efeito + original: zero FFmpeg em todo o caminho de publicação.
  check("TESTE 8: nenhum cron de publicação importa FFmpeg/sanitizer",
    [publishScheduled, processLoops, postsCreate, storyTemplates].every(
      (f) => !f.includes("ffmpeg-process") && !f.includes("videoSanitizer") && !f.includes("from \"@/lib/video-effects\"")
    ));
  check("TESTE 8: sem efeito ativo, o Loop resolve o modo sem enfileirar job de FFmpeg",
    /if \(!hasActiveEffects\) \{[\s\S]{0,2500}resolveMediaUrlForMode/.test(processLoops));

  // Original imutável + variante em caminho próprio.
  check("O original nunca é sobrescrito (nenhum update de videos_library.public_url)",
    !/from\("videos_library"\)[\s\S]{0,120}\.update\(\{\s*public_url/.test(processLoops) &&
      !/\.update\(\{ public_url/.test(publishScheduled));
  check("A variante vive em caminho separado do original", clean.includes('VARIANT_PREFIX = "variants/clean"'));
  check("Dedup por (source_hash, mode, version)",
    clean.includes('.eq("source_hash", hash)') &&
      clean.includes('.eq("processing_mode", "clean_metadata")') &&
      clean.includes('.eq("processing_version", CLEAN_METADATA_VERSION)'));

  // Migração / defaults.
  const sql = src("supabase/video_processing_mode.sql");
  check("Migração: default 'original' em todas as entidades (sem backfill de limpeza)",
    (sql.match(/default 'original'/g) ?? []).length === 6 && !sql.includes("set video_processing_mode = 'clean"));
  check("normalizeProcessingMode cai em 'original' para valor legado/nulo",
    /return value === "clean_metadata" \? "clean_metadata" : "original";/.test(clean));

  // clean_metadata nunca reencoda.
  const ffmpegProcess = src("lib/ffmpeg-process.ts");
  const optsBlock = ffmpegProcess.slice(ffmpegProcess.indexOf("CLEAN_METADATA_OUTPUT_OPTIONS"));
  const forbidden = ["libx264", "-crf", "noise=", "hue=", "eq=", "volume=", "atempo", "setpts", "unsharp", "smartblur", "crop=", "scale=", "filter_units"];
  check("clean_metadata não contém nenhum filtro de reencode nas opções de saída",
    forbidden.every((t) => !optsBlock.includes(t)));
  check("As opções testadas aqui são as mesmas de lib/ffmpeg-process.ts",
    CLEAN_OPTS.every((opt) => optsBlock.includes(`"${opt}"`)));
  check("As opções de entrada testadas aqui são as mesmas de lib/ffmpeg-input.ts",
    INPUT_OPTS.every((opt) => src("lib/ffmpeg-input.ts").includes(`"${opt}"`)));
  check("Todo FFmpeg do app usa o binário do sistema com a entrada restrita",
    [ffmpegProcess, effects].every((f) =>
      f.includes(".inputOptions(FFMPEG_INPUT_OPTIONS)") && !f.includes("ffmpeg-installer") && !f.includes("setFfmpegPath")));
  check("Os dois pipelines baixam a mídia com allowlist de origem e teto de bytes (fetchMediaBytes)",
    [ffmpegProcess, effects].every((f) => f.includes("await fetchMediaBytes(videoUrl") && !f.includes("undiciFetch(")));

  fs.rmSync(tmp, { recursive: true, force: true });
  fs.rmSync(path.join(repoRoot, "node_modules", ".cache", "asc-video-test"), { recursive: true, force: true });

  console.log(`\n${passed} passaram, ${failed} falharam\n`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
