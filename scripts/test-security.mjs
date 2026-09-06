/**
 * Testes das funções puras de segurança.
 *
 * Roda com:  node scripts/test-security.mjs
 *
 * Cobre a allowlist de mídia remota (SSRF): as rotas de proxy recebem a URL do
 * cliente, e a validação precisa barrar rede interna, esquemas não-HTTP e
 * domínios que só "parecem" permitidos.
 */

import fs from "fs";
import os from "os";
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

function run(bin, args) {
  return new Promise((resolve, reject) => {
    const p = spawn(bin, args, { stdio: "ignore", shell: process.platform === "win32" });
    p.on("close", (c) => (c === 0 ? resolve() : reject(new Error(`${bin} exit ${c}`))));
    p.on("error", reject);
  });
}

async function loadModule() {
  const buildDir = path.join(repoRoot, "node_modules", ".cache", "asc-security-test");
  fs.rmSync(buildDir, { recursive: true, force: true });
  fs.mkdirSync(buildDir, { recursive: true });
  const tsconfigPath = path.join(buildDir, "tsconfig.test.json");
  fs.writeFileSync(tsconfigPath, JSON.stringify({
    compilerOptions: {
      target: "es2022", module: "es2022", moduleResolution: "node",
      outDir: buildDir, rootDir: repoRoot, skipLibCheck: true, noEmitOnError: false,
    },
    files: [path.join(repoRoot, "lib/safe-media-fetch.ts")],
  }));
  await run("npx", ["tsc", "-p", tsconfigPath]).catch(() => {});
  fs.writeFileSync(path.join(buildDir, "package.json"), JSON.stringify({ type: "module" }));
  const out = path.join(buildDir, "lib", "safe-media-fetch.js");
  if (!fs.existsSync(out)) throw new Error("falha ao compilar lib/safe-media-fetch.ts");
  return import(pathToFileURL(out).href);
}

const ALLOW = ["cdninstagram.com", "fbcdn.net", "instagram.com", "supabase.co"];

async function main() {
  console.log("\n== Allowlist de mídia remota (SSRF) ==\n");
  const { isAllowedHost } = await loadModule();

  // Permitidos
  check("host exato da allowlist é aceito", isAllowedHost("https://instagram.com/x.mp4", ALLOW));
  check("subdomínio de host permitido é aceito", isAllowedHost("https://scontent-abc.cdninstagram.com/v/x.mp4", ALLOW));
  check("Supabase Storage é aceito", isAllowedHost("https://abc.supabase.co/storage/v1/object/public/x.mp4", ALLOW));

  // Bloqueados — domínio parecido
  check("domínio que apenas TERMINA com o nome permitido é bloqueado",
    !isAllowedHost("https://evil-instagram.com/x.mp4", ALLOW));
  check("domínio com o permitido como prefixo é bloqueado",
    !isAllowedHost("https://instagram.com.evil.net/x.mp4", ALLOW));

  // Bloqueados — rede interna e metadata
  check("localhost é bloqueado", !isAllowedHost("http://localhost/x", ALLOW));
  check("127.0.0.1 é bloqueado", !isAllowedHost("http://127.0.0.1/x", ALLOW));
  check("IP de metadata da cloud (169.254.169.254) é bloqueado",
    !isAllowedHost("http://169.254.169.254/latest/meta-data/", ALLOW));
  check("rede privada 10.x é bloqueada", !isAllowedHost("http://10.0.0.5/x", ALLOW));
  check("rede privada 192.168.x é bloqueada", !isAllowedHost("http://192.168.1.10/x", ALLOW));
  check("rede privada 172.16-31.x é bloqueada", !isAllowedHost("http://172.20.0.1/x", ALLOW));
  check("IPv6 loopback é bloqueado", !isAllowedHost("http://[::1]/x", ALLOW));

  // Bloqueados — esquemas
  check("file:// é bloqueado", !isAllowedHost("file:///etc/passwd", ALLOW));
  check("ftp:// é bloqueado", !isAllowedHost("ftp://instagram.com/x", ALLOW));
  check("URL inválida é bloqueada", !isAllowedHost("nao-e-url", ALLOW));

  // Garantia estrutural: as rotas de proxy usam o helper, não fetch cru.
  const dl = fs.readFileSync(path.join(repoRoot, "app/api/proxy-download/route.ts"), "utf8");
  const img = fs.readFileSync(path.join(repoRoot, "app/api/proxy-image/route.ts"), "utf8");
  check("proxy-download usa fetchAllowlisted (revalida redirect)",
    dl.includes("fetchAllowlisted(") && !/await fetch\(url/.test(dl));
  check("proxy-image usa fetchAllowlisted (revalida redirect)",
    img.includes("fetchAllowlisted(") && !/await fetch\(url/.test(img));

  // force-run precisa exigir admin ou CRON_SECRET (rota global, não escopada).
  const force = fs.readFileSync(path.join(repoRoot, "app/api/cron/force-run/route.ts"), "utf8");
  check("force-run exige papel de admin (ou CRON_SECRET)",
    force.includes('=== "admin"') && force.includes("CRON_SECRET"));

  fs.rmSync(path.join(repoRoot, "node_modules", ".cache", "asc-security-test"), { recursive: true, force: true });
  console.log(`\n${passed} passaram, ${failed} falharam\n`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
