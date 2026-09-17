#!/usr/bin/env node
/**
 * Rotação da ENCRYPTION_SECRET — re-cifra todas as colunas AES-256-GCM.
 *
 * Formato (idêntico a lib/encrypt.ts e python_server/session_store.py):
 *   chave = sha256(ENCRYPTION_SECRET)  ·  "iv_b64:tag_b64:ciphertext_b64"
 *
 * Garantias:
 *   - UMA transação para todas as tabelas. Qualquer falha = ROLLBACK de tudo.
 *   - Fase 1 (sem escrever nada): cada valor precisa decifrar com a chave
 *     ANTIGA (ou já estar na NOVA). Um único valor ilegível aborta a execução.
 *   - Fase 2: UPDATE condicionado ao ciphertext lido (WHERE col = antigo).
 *   - Fase 3 (ainda dentro da transação): relê do banco, decifra com a chave
 *     NOVA e compara com o texto original; confere que a chave antiga não abre
 *     mais nenhum valor. Divergência = ROLLBACK.
 *   - Idempotente: valor que já abre com a chave nova é pulado. Rodar de novo
 *     depois da troca de env pega linhas gravadas com a chave antiga no meio.
 *   - Nunca imprime texto claro nem ciphertext — só tabela, coluna, id, contagem.
 *
 * Uso:
 *   node scripts/rotate-encryption-secret.mjs            → DRY-RUN (faz tudo e dá ROLLBACK)
 *   node scripts/rotate-encryption-secret.mjs --commit   → grava de verdade
 *   node scripts/rotate-encryption-secret.mjs --verify   → só confere (leitura), exige só a chave NOVA
 *
 * Entradas (env ou prompt oculto):
 *   DATABASE_URL           string de conexão Postgres (Supabase → Connect → Session pooler)
 *   OLD_ENCRYPTION_SECRET  chave atual (não exigida em --verify)
 *   NEW_ENCRYPTION_SECRET  chave nova
 */
import crypto from "node:crypto";
import readline from "node:readline";
import pg from "pg";

// ─── Inventário ───────────────────────────────────────────────────────────────
// allowPlaintext: coluna que legitimamente guarda valor NÃO cifrado
// (instagram_accounts.access_token = token Meta em claro; só as sessões
// instagrapi são cifradas). Nas demais, valor fora do formato aborta.
const TARGETS = [
  { table: "proxy_pool", columns: ["proxy_url"] },
  { table: "user_meta_apps", columns: ["ig_app_secret"] },
  { table: "reader_accounts", columns: ["password_enc", "totp_secret_enc", "proxy_url", "session_settings"] },
  { table: "onboarding_jobs", columns: ["password_enc", "two_factor_enc", "proxy_url_enc", "session_settings"] },
  { table: "instagram_accounts", columns: ["proxy_url", "access_token"], allowPlaintext: ["access_token"] },
  { table: "account_logins", columns: ["password_hash", "two_factor_key"] },
  { table: "ig_browser_sessions", columns: ["storage_state_enc"] },
];

// ─── Cripto ───────────────────────────────────────────────────────────────────
const keyFrom = (secret) => crypto.createHash("sha256").update(secret).digest();

function isCipherShape(value) {
  const parts = value.split(":");
  if (parts.length !== 3) return false;
  const b64 = /^[A-Za-z0-9+/]*={0,2}$/;
  if (!parts.every((p) => b64.test(p))) return false;
  return Buffer.from(parts[0], "base64").length === 12 && Buffer.from(parts[1], "base64").length === 16;
}

function encryptWith(key, plaintext) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return `${iv.toString("base64")}:${cipher.getAuthTag().toString("base64")}:${enc.toString("base64")}`;
}

/** Devolve o texto claro ou null se a chave não abre (tag GCM inválida). */
function tryDecrypt(key, ciphertext) {
  try {
    const [ivB64, tagB64, encB64] = ciphertext.split(":");
    const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(ivB64, "base64"));
    decipher.setAuthTag(Buffer.from(tagB64, "base64"));
    return decipher.update(Buffer.from(encB64, "base64"), undefined, "utf8") + decipher.final("utf8");
  } catch {
    return null;
  }
}

// ─── Entrada segura ───────────────────────────────────────────────────────────
function promptHidden(label) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    process.stdout.write(label);
    rl._writeToOutput = () => {}; // não ecoa o que é digitado
    rl.question("", (answer) => {
      rl.close();
      process.stdout.write("\n");
      resolve(answer.trim());
    });
  });
}

async function readInput(name) {
  const v = process.env[name]?.trim();
  if (v) return v;
  if (!process.stdin.isTTY) throw new Error(`${name} não definido`);
  return promptHidden(`${name}: `);
}

const q = (ident) => `"${ident.replace(/"/g, '""')}"`;
const log = (...a) => console.log(...a);

function fail(msg) {
  console.error(`\n✖ ${msg}`);
  process.exit(1);
}

// ─── Main ─────────────────────────────────────────────────────────────────────
const args = new Set(process.argv.slice(2));
const MODE = args.has("--verify") ? "verify" : args.has("--commit") ? "commit" : "dry-run";

const databaseUrl = await readInput("DATABASE_URL");
const oldSecret = MODE === "verify" ? null : await readInput("OLD_ENCRYPTION_SECRET");
const newSecret = await readInput("NEW_ENCRYPTION_SECRET");

if (!/^[0-9a-f]{64}$/i.test(newSecret)) {
  if (!args.has("--allow-non-hex")) {
    fail("NEW_ENCRYPTION_SECRET precisa ser hex de 64 caracteres (use --allow-non-hex só para reverter à chave antiga).");
  }
  log("⚠ NEW_ENCRYPTION_SECRET não é hex de 64 chars (--allow-non-hex).");
}
if (oldSecret !== null && oldSecret === newSecret) fail("Chave antiga e nova são iguais.");

const OLD = oldSecret === null ? null : keyFrom(oldSecret);
const NEW = keyFrom(newSecret);

// Autoteste de formato antes de tocar no banco.
{
  const probe = "autoteste-rotacao-ção-😀";
  const c = encryptWith(NEW, probe);
  if (!isCipherShape(c) || tryDecrypt(NEW, c) !== probe || (OLD && tryDecrypt(OLD, c) !== null)) {
    fail("Autoteste de criptografia falhou — nada foi feito.");
  }
}

// Supabase exige TLS; "sslmode=disable" na URL só para teste local.
const sslOpt = /sslmode=disable/.test(databaseUrl) ? false : { rejectUnauthorized: false };
const pgConfig = { connectionString: databaseUrl.replace(/[?&]sslmode=disable/, ""), ssl: sslOpt };
const client = new pg.Client(pgConfig);
await client.connect();
log(`\nModo: ${MODE.toUpperCase()}  ·  ${new Date().toISOString()}`);

/** Lê e classifica tudo. Não escreve. */
async function scan({ lock }) {
  const report = []; // { table, column, nullCount, oldKey, newKey, plaintextAllowed }
  const errors = []; // { table, column, id, reason }
  const plan = []; // { table, id, updates: [{ column, oldCipher, newCipher, plaintext }] }

  for (const { table, columns, allowPlaintext = [] } of TARGETS) {
    const cols = columns.map(q).join(", ");
    const where = columns.map((c) => `${q(c)} is not null`).join(" or ");
    const { rows } = await client.query(
      `select id, ${cols} from public.${q(table)} where ${where} order by id${lock ? " for update" : ""}`,
    );
    const stats = Object.fromEntries(
      columns.map((c) => [c, { table, column: c, total: 0, oldKey: 0, newKey: 0, plaintextAllowed: 0 }]),
    );

    for (const row of rows) {
      const updates = [];
      for (const column of columns) {
        const value = row[column];
        if (value === null || value === undefined) continue;
        const s = stats[column];
        s.total++;
        if (typeof value !== "string" || !isCipherShape(value)) {
          if (allowPlaintext.includes(column)) { s.plaintextAllowed++; continue; }
          errors.push({ table, column, id: row.id, reason: "fora do formato iv:tag:enc" });
          continue;
        }
        if (tryDecrypt(NEW, value) !== null) { s.newKey++; continue; }
        const plaintext = OLD ? tryDecrypt(OLD, value) : null;
        if (plaintext === null) {
          errors.push({ table, column, id: row.id, reason: OLD ? "não abre com a chave antiga nem com a nova" : "não abre com a chave nova" });
          continue;
        }
        s.oldKey++;
        updates.push({ column, oldCipher: value, plaintext });
      }
      if (updates.length) plan.push({ table, id: row.id, updates });
    }
    report.push(...Object.values(stats));
  }
  return { report, errors, plan };
}

function printReport(report, title) {
  log(`\n${title}`);
  log("tabela".padEnd(22) + "coluna".padEnd(20) + "não-nulos".padStart(10) + "chave antiga".padStart(14) + "chave nova".padStart(12) + "claro(ok)".padStart(11));
  for (const r of report) {
    log(r.table.padEnd(22) + r.column.padEnd(20) + String(r.total).padStart(10) + String(r.oldKey).padStart(14) + String(r.newKey).padStart(12) + String(r.plaintextAllowed).padStart(11));
  }
}

function printErrors(errors) {
  console.error(`\n✖ ${errors.length} valor(es) ilegível(is):`);
  for (const e of errors.slice(0, 50)) console.error(`   ${e.table}.${e.column}  id=${e.id}  → ${e.reason}`);
  if (errors.length > 50) console.error(`   … e mais ${errors.length - 50}`);
}

try {
  // ── VERIFY: só leitura ──────────────────────────────────────────────────────
  if (MODE === "verify") {
    const { report, errors } = await scan({ lock: false });
    printReport(report, "Verificação (chave NOVA):");
    if (errors.length) { printErrors(errors); process.exitCode = 1; }
    else log("\n✔ Todos os valores cifrados abrem com a chave NOVA.");
  } else {
    await client.query("begin");
    await client.query("set local lock_timeout = '15s'");
    await client.query("set local statement_timeout = '120s'");

    // ── Fase 1: validação completa, nada gravado ──────────────────────────────
    const { report, errors, plan } = await scan({ lock: true });
    printReport(report, "Fase 1 — inventário e validação:");
    if (errors.length) {
      printErrors(errors);
      await client.query("rollback");
      fail("Abortado na validação. NADA foi gravado.");
    }
    const totalValues = plan.reduce((n, p) => n + p.updates.length, 0);
    log(`\n✔ Validação ok. ${totalValues} valor(es) em ${plan.length} linha(s) para re-cifrar.`);

    // ── Fase 2: re-cifra e grava ──────────────────────────────────────────────
    for (const item of plan) {
      const sets = [];
      const conds = [];
      const params = [item.id];
      for (const u of item.updates) {
        u.newCipher = encryptWith(NEW, u.plaintext);
        if (tryDecrypt(NEW, u.newCipher) !== u.plaintext) throw new Error(`re-cifra inconsistente em ${item.table}.${u.column} id=${item.id}`);
        params.push(u.newCipher, u.oldCipher);
        sets.push(`${q(u.column)} = $${params.length - 1}`);
        conds.push(`${q(u.column)} = $${params.length}`);
      }
      const res = await client.query(
        `update public.${q(item.table)} set ${sets.join(", ")} where id = $1 and ${conds.join(" and ")}`,
        params,
      );
      if (res.rowCount !== 1) throw new Error(`UPDATE afetou ${res.rowCount} linhas em ${item.table} id=${item.id} (valor mudou durante a migração?)`);
    }
    log(`✔ Fase 2 — ${plan.length} UPDATE(s) aplicados na transação.`);

    // ── Fase 3: relê do banco e compara com o texto original ─────────────────
    let checked = 0;
    for (const item of plan) {
      const cols = item.updates.map((u) => q(u.column)).join(", ");
      const { rows } = await client.query(`select ${cols} from public.${q(item.table)} where id = $1`, [item.id]);
      if (rows.length !== 1) throw new Error(`linha sumiu: ${item.table} id=${item.id}`);
      for (const u of item.updates) {
        const stored = rows[0][u.column];
        if (stored !== u.newCipher) throw new Error(`valor gravado difere do esperado: ${item.table}.${u.column} id=${item.id}`);
        if (tryDecrypt(NEW, stored) !== u.plaintext) throw new Error(`chave nova não reproduz o original: ${item.table}.${u.column} id=${item.id}`);
        if (tryDecrypt(OLD, stored) !== null) throw new Error(`chave antiga ainda abre: ${item.table}.${u.column} id=${item.id}`);
        checked++;
      }
    }
    const after = await scan({ lock: false });
    const leftovers = after.report.reduce((n, r) => n + r.oldKey, 0);
    if (after.errors.length || leftovers !== 0) {
      printErrors(after.errors);
      throw new Error(`varredura pós-gravação: ${leftovers} valor(es) ainda na chave antiga`);
    }
    printReport(after.report, "Fase 3 — releitura dentro da transação:");
    log(`\n✔ ${checked} valor(es) relidos e idênticos ao original com a chave nova.`);

    // ── Log do que foi migrado ────────────────────────────────────────────────
    log("\nMigrado por coluna:");
    for (const r of report) if (r.oldKey) log(`   ${r.table}.${r.column}: ${r.oldKey} linha(s)`);
    if (!totalValues) log("   (nada — tudo já estava na chave nova)");

    if (MODE === "commit") {
      await client.query("commit");
      log("\n✔ COMMIT feito.");
    } else {
      await client.query("rollback");
      log("\n↺ DRY-RUN: ROLLBACK feito — nada foi gravado. Rode com --commit para aplicar.");
    }
  }
} catch (err) {
  try { await client.query("rollback"); } catch { /* conexão já caiu */ }
  console.error(`\n✖ ${err.message}`);
  console.error("↺ ROLLBACK — nenhuma alteração foi gravada.");
  process.exitCode = 1;
} finally {
  await client.end();
}

// Pós-commit: confere de novo por uma conexão NOVA (dados efetivamente persistidos).
if (MODE === "commit" && !process.exitCode) {
  const c2 = new pg.Client(pgConfig);
  await c2.connect();
  let bad = 0;
  for (const { table, columns, allowPlaintext = [] } of TARGETS) {
    const { rows } = await c2.query(`select ${columns.map(q).join(", ")} from public.${q(table)}`);
    for (const row of rows) for (const c of columns) {
      const v = row[c];
      if (v == null || (!isCipherShape(v) && allowPlaintext.includes(c))) continue;
      if (!isCipherShape(v) || tryDecrypt(NEW, v) === null) bad++;
    }
  }
  await c2.end();
  if (bad) { console.error(`✖ Pós-commit: ${bad} valor(es) não abrem com a chave nova.`); process.exitCode = 1; }
  else log("✔ Pós-commit (conexão nova): tudo abre com a chave nova.");
}
