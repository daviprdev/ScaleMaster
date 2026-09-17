#!/usr/bin/env node
/**
 * Rotação da ENCRYPTION_SECRET — versão LOCAL (chaves digitadas).
 *
 * A lógica mora em lib/encryption-rotation.ts, a mesma usada pela rota
 * /api/internal/rotate-encryption-secret (que roda na Vercel e lê a chave
 * antiga do process.env). Ver o cabeçalho da lib para as garantias.
 *
 * Uso:
 *   node scripts/rotate-encryption-secret.mjs            → DRY-RUN (faz tudo e dá ROLLBACK)
 *   node scripts/rotate-encryption-secret.mjs --commit   → grava de verdade
 *   node scripts/rotate-encryption-secret.mjs --verify   → só confere (leitura), exige só a chave NOVA
 *   --allow-non-hex                                      → aceita chave nova não-hex (reverter)
 *
 * Entradas (env ou prompt oculto):
 *   DATABASE_URL           string de conexão Postgres ("sslmode=disable" só em teste local)
 *   OLD_ENCRYPTION_SECRET  chave atual (não exigida em --verify)
 *   NEW_ENCRYPTION_SECRET  chave nova
 */
import readline from "node:readline";
import pg from "pg";
import { rotateEncryption, verifyEncryption, validateNewSecret } from "../lib/encryption-rotation.ts";

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

function printStats(title, stats) {
  if (!stats?.length) return;
  console.log(`\n${title}`);
  console.log("tabela".padEnd(22) + "coluna".padEnd(20) + "não-nulos".padStart(10) + "chave antiga".padStart(14) + "chave nova".padStart(12) + "claro(ok)".padStart(11));
  for (const s of stats) {
    console.log(s.table.padEnd(22) + s.column.padEnd(20) + String(s.nonNull).padStart(10) + String(s.oldKey).padStart(14) + String(s.newKey).padStart(12) + String(s.plaintextAllowed).padStart(11));
  }
}

const args = new Set(process.argv.slice(2));
const MODE = args.has("--verify") ? "verify" : args.has("--commit") ? "commit" : "dry-run";

const databaseUrl = await readInput("DATABASE_URL");
const oldSecret = MODE === "verify" ? null : await readInput("OLD_ENCRYPTION_SECRET");
const newSecret = await readInput("NEW_ENCRYPTION_SECRET");

const inputError = validateNewSecret(newSecret, { allowNonHex: args.has("--allow-non-hex") });
if (inputError) {
  console.error(`✖ ${inputError} (use --allow-non-hex só para reverter à chave antiga)`);
  process.exit(1);
}

const connect = async () => {
  const ssl = /sslmode=disable/.test(databaseUrl) ? false : { rejectUnauthorized: false };
  const client = new pg.Client({ connectionString: databaseUrl.replace(/[?&]sslmode=disable/, ""), ssl });
  client.on("error", (err) => console.error(`conexão: ${err.message}`)); // sem handler o processo cai
  await client.connect();
  return client;
};

console.log(`Modo: ${MODE.toUpperCase()}  ·  ${new Date().toISOString()}`);
const result = MODE === "verify"
  ? await verifyEncryption(connect, newSecret)
  : await rotateEncryption(connect, { oldSecret, newSecret, commit: MODE === "commit" });

printStats("Antes (validação):", result.before);
printStats(MODE === "verify" ? "Verificação:" : "Depois (releitura):", result.after);

if (result.valuesToMigrate) {
  console.log("\nMigrado por coluna:");
  for (const s of result.before) if (s.oldKey) console.log(`   ${s.table}.${s.column}: ${s.oldKey} linha(s)`);
}
if (result.errors.length) {
  console.error(`\n✖ ${result.errors.length} valor(es) com problema:`);
  for (const e of result.errors.slice(0, 50)) console.error(`   ${e.table}.${e.column}  id=${e.id}  → ${e.reason}`);
}
console.log(`\n${result.ok ? "✔" : "✖"} ${result.message}`);
process.exit(result.ok ? 0 : 1);
