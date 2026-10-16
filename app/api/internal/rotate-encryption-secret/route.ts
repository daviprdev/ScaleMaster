/**
 * POST /api/internal/rotate-encryption-secret — ROTA TEMPORÁRIA
 *
 * Rotaciona a ENCRYPTION_SECRET dentro do runtime do servidor, sem ninguém
 * precisar ver a chave antiga: ela é lida de process.env.ENCRYPTION_SECRET e
 * nunca sai daqui. Só a chave NOVA chega pelo corpo da requisição.
 *
 * DESLIGADA POR PADRÃO. Só responde quando a env var KEY_ROTATION_TOKEN existe
 * (≥ 32 chars). Sem ela devolve 404 — remover a env var + redeploy desliga a
 * rota sem mexer no código.
 *
 *   Authorization: Bearer <KEY_ROTATION_TOKEN>
 *   ?mode=dry-run (padrão) → faz tudo na transação e dá ROLLBACK
 *   ?mode=commit           → grava
 *   ?mode=verify           → só leitura: tudo abre com a chave do corpo?
 *   body: { "newSecret": "<hex de 64>" }
 *
 * A resposta só traz tabela/coluna/contagens, ids de linha com problema e o
 * TIPO da conexão usada — nunca valores, ciphertext, chaves ou credenciais.
 *
 * Lógica compartilhada com scripts/rotate-encryption-secret.mjs em
 * lib/encryption-rotation.ts.
 */
import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "crypto";
import pg from "pg";
import {
  rotateEncryption,
  verifyEncryption,
  validateNewSecret,
  keyFromSecret,
  type RotationDb,
} from "@/lib/encryption-rotation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const NOT_FOUND = () => NextResponse.json({ error: "Not Found" }, { status: 404 });

function secureEquals(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  return bufA.length === bufB.length && timingSafeEqual(bufA, bufB);
}

// ─── Conexão Postgres ─────────────────────────────────────────────────────────
// O app fala com o Supabase só pela API REST (supabase-js); nenhuma rota usa
// connection string. A rotação precisa de transação de verdade, então procura
// as variáveis de conexão Postgres mais comuns, em ordem.
const DB_ENV_CANDIDATES = [
  "ROTATION_DATABASE_URL",
  "POSTGRES_URL_NON_POOLING",
  "POSTGRES_URL",
  "DATABASE_URL",
  "SUPABASE_DB_URL",
] as const;

type DbKind = "pooler-session" | "pooler-transaction" | "direct" | "other";

function classify(raw: string): { kind: DbKind; rank: number } {
  try {
    const u = new URL(raw);
    const port = u.port || "5432";
    if (u.hostname.endsWith(".pooler.supabase.com")) {
      return port === "6543" ? { kind: "pooler-transaction", rank: 1 } : { kind: "pooler-session", rank: 0 };
    }
    // db.<ref>.supabase.co só resolve IPv6 (sem o add-on de IPv4) e nem todo
    // ambiente tem saída IPv6 — fica por último.
    if (/^db\.[a-z0-9]+\.supabase\.co$/.test(u.hostname)) return { kind: "direct", rank: 3 };
    return { kind: port === "6543" ? "pooler-transaction" : "other", rank: 2 };
  } catch {
    return { kind: "other", rank: 9 };
  }
}

/** Remove sslmode da URL — o pg 8 trata sslmode=require como verify-full e
 *  ignora o objeto ssl; o TLS é configurado explicitamente abaixo. */
function withoutSslMode(raw: string): string {
  try {
    const u = new URL(raw);
    u.searchParams.delete("sslmode");
    return u.toString();
  } catch {
    return raw;
  }
}

type DbAttempt = { source: string; kind: DbKind; ok: boolean; error?: string };

async function pickConnection(): Promise<{ connect: () => Promise<RotationDb>; source: string; kind: DbKind; attempts: DbAttempt[] } | { error: string; attempts: DbAttempt[] }> {
  const candidates = DB_ENV_CANDIDATES
    .map((name) => ({ name, value: process.env[name]?.trim() }))
    .filter((c): c is { name: (typeof DB_ENV_CANDIDATES)[number]; value: string } => !!c.value)
    .map((c) => ({ ...c, ...classify(c.value) }))
    .sort((a, b) => a.rank - b.rank);

  const attempts: DbAttempt[] = [];
  if (!candidates.length) {
    return { error: `nenhuma connection string encontrada (procurei ${DB_ENV_CANDIDATES.join(", ")})`, attempts };
  }

  for (const c of candidates) {
    const connect = async (): Promise<RotationDb> => {
      const client = new pg.Client({
        connectionString: withoutSslMode(c.value),
        // Supabase exige TLS. "sslmode=disable" explícito só serve para teste local.
        ssl: /[?&]sslmode=disable(&|$)/.test(c.value) ? false : { rejectUnauthorized: false },
        connectionTimeoutMillis: 10_000,
      });
      // Sem handler, um evento 'error' do socket derruba o processo inteiro.
      // O Postgres desfaz sozinho a transação aberta quando a conexão cai.
      client.on("error", (err) => console.error("[rotate-encryption-secret] erro de conexão:", err.message));
      await client.connect();
      return client;
    };
    try {
      const probe = await connect();
      await probe.query("select 1");
      await probe.end();
      attempts.push({ source: c.name, kind: c.kind, ok: true });
      return { connect, source: c.name, kind: c.kind, attempts };
    } catch (err) {
      // Mensagem do pg traz no máximo host/usuário, nunca a senha; corta por garantia.
      const msg = (err instanceof Error ? err.message : String(err)).replace(/:\/\/[^@\s]*@/g, "://<credenciais>@");
      attempts.push({ source: c.name, kind: c.kind, ok: false, error: msg.slice(0, 200) });
    }
  }
  return { error: "nenhuma connection string conectou", attempts };
}

// ─── Handler ──────────────────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  const token = process.env.KEY_ROTATION_TOKEN?.trim();
  if (!token || token.length < 32) return NOT_FOUND();

  const header = req.headers.get("authorization") ?? "";
  if (!secureEquals(header, `Bearer ${token}`)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const modeParam = new URL(req.url).searchParams.get("mode") ?? "dry-run";
  if (!["dry-run", "commit", "verify"].includes(modeParam)) {
    return NextResponse.json({ error: "mode deve ser dry-run, commit ou verify" }, { status: 400 });
  }
  const mode = modeParam as "dry-run" | "commit" | "verify";

  let newSecret: unknown;
  try {
    newSecret = ((await req.json()) as { newSecret?: unknown })?.newSecret;
  } catch {
    return NextResponse.json({ error: "corpo JSON inválido" }, { status: 400 });
  }
  const inputError = validateNewSecret(newSecret);
  if (inputError) return NextResponse.json({ error: inputError }, { status: 400 });
  const newKey = (newSecret as string).trim();

  const currentSecret = process.env.ENCRYPTION_SECRET;
  if (!currentSecret) {
    return NextResponse.json({ error: "ENCRYPTION_SECRET ausente no ambiente" }, { status: 503 });
  }
  // Só um booleano — diz se a env deste deploy já é a chave nova.
  const envKeyMatchesNew = keyFromSecret(currentSecret).equals(keyFromSecret(newKey));

  if (mode !== "verify" && envKeyMatchesNew) {
    return NextResponse.json(
      { error: "a ENCRYPTION_SECRET deste deploy já é a chave nova — use mode=verify", envKeyMatchesNew },
      { status: 409 },
    );
  }

  const db = await pickConnection();
  if ("error" in db) {
    return NextResponse.json(
      {
        error: db.error,
        attempts: db.attempts,
        hint: "Crie a env ROTATION_DATABASE_URL com a URI do Supabase → Connect → Session pooler (porta 5432) e faça redeploy.",
      },
      { status: 503 },
    );
  }

  const result = mode === "verify"
    ? await verifyEncryption(db.connect, newKey)
    : await rotateEncryption(db.connect, { oldSecret: currentSecret, newSecret: newKey, commit: mode === "commit", statementTimeoutMs: 45_000 });

  const migrated = result.before
    .filter((s) => s.oldKey > 0)
    .map((s) => ({ table: s.table, column: s.column, rows: s.oldKey }));

  console.log(
    `[rotate-encryption-secret] mode=${mode} ok=${result.ok} committed=${result.committed} ` +
    `values=${result.valuesToMigrate} rows=${result.rowsToUpdate} errors=${result.errors.length} db=${db.source}/${db.kind}`,
  );

  return NextResponse.json(
    {
      ok: result.ok,
      mode,
      committed: result.committed,
      failedAt: result.failedAt ?? null,
      message: result.message,
      envKeyMatchesNew,
      database: { source: db.source, kind: db.kind, attempts: db.attempts },
      valuesToMigrate: result.valuesToMigrate,
      rowsToUpdate: result.rowsToUpdate,
      migrated,
      before: result.before,
      after: result.after,
      errors: result.errors,
    },
    { status: result.ok ? 200 : result.failedAt === "connect" ? 503 : 422 },
  );
}

export async function GET() {
  // Sem token configurado a rota "não existe"; com token, só POST.
  const token = process.env.KEY_ROTATION_TOKEN?.trim();
  if (!token || token.length < 32) return NOT_FOUND();
  return NextResponse.json({ error: "use POST" }, { status: 405 });
}
