/**
 * encryption-rotation.ts — núcleo da rotação da ENCRYPTION_SECRET.
 *
 * Usado por DOIS chamadores, com a mesma lógica:
 *   - scripts/rotate-encryption-secret.mjs  (roda local, chaves digitadas)
 *   - app/api/internal/rotate-encryption-secret/route.ts (roda na Vercel e lê
 *     a chave antiga do process.env, sem ninguém precisar vê-la)
 *
 * Formato (idêntico a lib/encrypt.ts e python_server/session_store.py):
 *   chave = sha256(ENCRYPTION_SECRET) · "iv_b64:tag_b64:ciphertext_b64"
 *
 * Garantias:
 *   - UMA transação para todas as tabelas; qualquer falha = ROLLBACK de tudo.
 *   - Fase 1 (nada gravado): cada valor abre com a chave ANTIGA ou já está na
 *     NOVA. Um valor ilegível aborta antes de qualquer UPDATE.
 *   - Fase 2: UPDATE condicionado ao ciphertext lido (WHERE col = antigo).
 *   - Fase 3 (ainda na transação): relê, compara com o texto original usando a
 *     chave nova, confere que a antiga não abre nada e revarre tudo.
 *   - Pós-commit: confere de novo por uma conexão NOVA.
 *   - O resultado só carrega tabela, coluna, id de linha e contagens — nunca
 *     texto claro, ciphertext ou chave.
 *
 * Só sintaxe TypeScript "apagável" (sem enum/namespace), para o script .mjs
 * conseguir importar este arquivo direto com o type stripping do Node 24.
 */
import crypto from "node:crypto";

// ─── Inventário ───────────────────────────────────────────────────────────────
// allowPlaintext: coluna que legitimamente guarda valor NÃO cifrado
// (instagram_accounts.access_token = token Meta em claro; só as sessões
// instagrapi são cifradas). Nas demais, valor fora do formato aborta.
export const ROTATION_TARGETS: { table: string; columns: string[]; allowPlaintext?: string[] }[] = [
  { table: "proxy_pool", columns: ["proxy_url"] },
  { table: "user_meta_apps", columns: ["ig_app_secret"] },
  { table: "reader_accounts", columns: ["password_enc", "totp_secret_enc", "proxy_url", "session_settings"] },
  { table: "onboarding_jobs", columns: ["password_enc", "two_factor_enc", "proxy_url_enc", "session_settings"] },
  { table: "instagram_accounts", columns: ["proxy_url", "access_token"], allowPlaintext: ["access_token"] },
  { table: "account_logins", columns: ["password_hash", "two_factor_key"] },
  { table: "ig_browser_sessions", columns: ["storage_state_enc"] },
];

// ─── Tipos ────────────────────────────────────────────────────────────────────
export type RotationDb = {
  query(text: string, params?: unknown[]): Promise<{ rows: any[]; rowCount: number | null }>;
  end(): Promise<void>;
};

export type ColumnStat = {
  table: string;
  column: string;
  nonNull: number;
  /** Valores que estavam (ou estão, em verify) na chave antiga. */
  oldKey: number;
  /** Valores que já abrem com a chave nova. */
  newKey: number;
  plaintextAllowed: number;
};

export type RowError = { table: string; column: string; id: string; reason: string };

export type RotationResult = {
  ok: boolean;
  mode: "dry-run" | "commit" | "verify";
  committed: boolean;
  /** Fase em que parou (quando ok=false). */
  failedAt?: "input" | "connect" | "validation" | "write" | "reread" | "post-commit";
  message: string;
  valuesToMigrate: number;
  rowsToUpdate: number;
  /** Inventário antes de gravar (validação). */
  before: ColumnStat[];
  /** Inventário relido dentro da transação (ou pós-commit / verify). */
  after: ColumnStat[] | null;
  errors: RowError[];
};

// ─── Cripto ───────────────────────────────────────────────────────────────────
export const keyFromSecret = (secret: string): Buffer => crypto.createHash("sha256").update(secret).digest();

export function isCipherShape(value: string): boolean {
  const parts = value.split(":");
  if (parts.length !== 3) return false;
  const b64 = /^[A-Za-z0-9+/]*={0,2}$/;
  if (!parts.every((p) => b64.test(p))) return false;
  return Buffer.from(parts[0], "base64").length === 12 && Buffer.from(parts[1], "base64").length === 16;
}

export function encryptWithKey(key: Buffer, plaintext: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return `${iv.toString("base64")}:${cipher.getAuthTag().toString("base64")}:${enc.toString("base64")}`;
}

/** Texto claro, ou null se a chave não abre (tag GCM inválida). */
export function tryDecryptWithKey(key: Buffer, ciphertext: string): string | null {
  try {
    const [ivB64, tagB64, encB64] = ciphertext.split(":");
    const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(ivB64, "base64"));
    decipher.setAuthTag(Buffer.from(tagB64, "base64"));
    return decipher.update(Buffer.from(encB64, "base64"), undefined, "utf8") + decipher.final("utf8");
  } catch {
    return null;
  }
}

/** Valida a chave nova. Retorna a mensagem de erro, ou null se ok. */
export function validateNewSecret(newSecret: unknown, opts: { allowNonHex?: boolean } = {}): string | null {
  if (typeof newSecret !== "string" || newSecret.trim() === "") return "chave nova ausente";
  if (!opts.allowNonHex && !/^[0-9a-f]{64}$/i.test(newSecret.trim())) {
    return "chave nova precisa ser hex de 64 caracteres";
  }
  return null;
}

/** Mensagem de erro sem nada que pareça ciphertext. */
function safeMessage(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  return msg.replace(/[A-Za-z0-9+/=]{12,}:[A-Za-z0-9+/=]{12,}:[A-Za-z0-9+/=]*/g, "<omitido>").slice(0, 300);
}

const q = (ident: string) => `"${ident.replace(/"/g, '""')}"`;

// ─── Varredura ────────────────────────────────────────────────────────────────
type PlanItem = {
  table: string;
  id: string;
  updates: { column: string; oldCipher: string; plaintext: string; newCipher?: string }[];
};

async function scan(db: RotationDb, keys: { old: Buffer | null; new: Buffer }, lock: boolean) {
  const stats: ColumnStat[] = [];
  const errors: RowError[] = [];
  const plan: PlanItem[] = [];

  for (const { table, columns, allowPlaintext = [] } of ROTATION_TARGETS) {
    const where = columns.map((c) => `${q(c)} is not null`).join(" or ");
    const { rows } = await db.query(
      `select id::text as id, ${columns.map(q).join(", ")} from public.${q(table)} where ${where} order by id${lock ? " for update" : ""}`,
    );
    const byCol = new Map<string, ColumnStat>(
      columns.map((c) => [c, { table, column: c, nonNull: 0, oldKey: 0, newKey: 0, plaintextAllowed: 0 }]),
    );

    for (const row of rows) {
      const updates: PlanItem["updates"] = [];
      for (const column of columns) {
        const value = row[column];
        if (value === null || value === undefined) continue;
        const s = byCol.get(column)!;
        s.nonNull++;
        if (typeof value !== "string" || !isCipherShape(value)) {
          if (allowPlaintext.includes(column)) { s.plaintextAllowed++; continue; }
          errors.push({ table, column, id: row.id, reason: "fora do formato iv:tag:enc" });
          continue;
        }
        if (tryDecryptWithKey(keys.new, value) !== null) { s.newKey++; continue; }
        const plaintext = keys.old ? tryDecryptWithKey(keys.old, value) : null;
        if (plaintext === null) {
          errors.push({
            table, column, id: row.id,
            reason: keys.old ? "não abre com a chave antiga nem com a nova" : "não abre com a chave informada",
          });
          continue;
        }
        s.oldKey++;
        updates.push({ column, oldCipher: value, plaintext });
      }
      if (updates.length) plan.push({ table, id: row.id, updates });
    }
    stats.push(...byCol.values());
  }
  return { stats, errors, plan };
}

// ─── Verificação (só leitura) ─────────────────────────────────────────────────
export async function verifyEncryption(connect: () => Promise<RotationDb>, secret: string): Promise<RotationResult> {
  const base: RotationResult = {
    ok: false, mode: "verify", committed: false, message: "", valuesToMigrate: 0, rowsToUpdate: 0,
    before: [], after: null, errors: [],
  };
  let db: RotationDb;
  try { db = await connect(); } catch (err) {
    return { ...base, failedAt: "connect", message: `falha ao conectar: ${safeMessage(err)}` };
  }
  try {
    const { stats, errors } = await scan(db, { old: null, new: keyFromSecret(secret) }, false);
    const ok = errors.length === 0;
    return {
      ...base, ok, after: stats, errors: errors.slice(0, 200),
      failedAt: ok ? undefined : "validation",
      message: ok ? "todos os valores cifrados abrem com a chave informada" : `${errors.length} valor(es) não abrem com a chave informada`,
    };
  } catch (err) {
    return { ...base, failedAt: "validation", message: safeMessage(err) };
  } finally {
    await db.end().catch(() => {});
  }
}

// ─── Rotação ──────────────────────────────────────────────────────────────────
export async function rotateEncryption(
  connect: () => Promise<RotationDb>,
  opts: { oldSecret: string; newSecret: string; commit: boolean; statementTimeoutMs?: number },
): Promise<RotationResult> {
  const mode = opts.commit ? "commit" : "dry-run";
  const result: RotationResult = {
    ok: false, mode, committed: false, message: "", valuesToMigrate: 0, rowsToUpdate: 0,
    before: [], after: null, errors: [],
  };

  if (!opts.oldSecret) return { ...result, failedAt: "input", message: "chave antiga ausente" };
  if (opts.oldSecret === opts.newSecret) return { ...result, failedAt: "input", message: "chave antiga e nova são iguais" };

  const OLD = keyFromSecret(opts.oldSecret);
  const NEW = keyFromSecret(opts.newSecret);

  // Autoteste antes de tocar no banco.
  const probe = "autoteste-rotacao-ção-😀";
  const probeCipher = encryptWithKey(NEW, probe);
  if (!isCipherShape(probeCipher) || tryDecryptWithKey(NEW, probeCipher) !== probe || tryDecryptWithKey(OLD, probeCipher) !== null) {
    return { ...result, failedAt: "input", message: "autoteste de criptografia falhou" };
  }

  let db: RotationDb;
  try { db = await connect(); } catch (err) {
    return { ...result, failedAt: "connect", message: `falha ao conectar: ${safeMessage(err)}` };
  }

  let phase: RotationResult["failedAt"] = "validation";
  try {
    await db.query("begin");
    await db.query("set local lock_timeout = '15s'");
    await db.query(`set local statement_timeout = '${Math.max(5000, opts.statementTimeoutMs ?? 120000)}ms'`);

    // ── Fase 1 ──
    const first = await scan(db, { old: OLD, new: NEW }, true);
    result.before = first.stats;
    result.valuesToMigrate = first.plan.reduce((n, p) => n + p.updates.length, 0);
    result.rowsToUpdate = first.plan.length;
    if (first.errors.length) {
      await db.query("rollback");
      return {
        ...result, failedAt: "validation", errors: first.errors.slice(0, 200),
        message: `${first.errors.length} valor(es) ilegível(is) — nada foi gravado`,
      };
    }

    // ── Fase 2 ──
    phase = "write";
    for (const item of first.plan) {
      const sets: string[] = [];
      const conds: string[] = [];
      const params: unknown[] = [item.id];
      for (const u of item.updates) {
        u.newCipher = encryptWithKey(NEW, u.plaintext);
        if (tryDecryptWithKey(NEW, u.newCipher) !== u.plaintext) throw new Error(`re-cifra inconsistente em ${item.table}.${u.column} id=${item.id}`);
        params.push(u.newCipher, u.oldCipher);
        sets.push(`${q(u.column)} = $${params.length - 1}`);
        conds.push(`${q(u.column)} = $${params.length}`);
      }
      const res = await db.query(
        `update public.${q(item.table)} set ${sets.join(", ")} where id::text = $1 and ${conds.join(" and ")}`,
        params,
      );
      if (res.rowCount !== 1) throw new Error(`UPDATE afetou ${res.rowCount} linha(s) em ${item.table} id=${item.id}`);
    }

    // ── Fase 3 ──
    phase = "reread";
    for (const item of first.plan) {
      const { rows } = await db.query(
        `select ${item.updates.map((u) => q(u.column)).join(", ")} from public.${q(item.table)} where id::text = $1`,
        [item.id],
      );
      if (rows.length !== 1) throw new Error(`linha sumiu: ${item.table} id=${item.id}`);
      for (const u of item.updates) {
        const stored = rows[0][u.column];
        if (stored !== u.newCipher) throw new Error(`valor gravado difere do esperado: ${item.table}.${u.column} id=${item.id}`);
        if (tryDecryptWithKey(NEW, stored) !== u.plaintext) throw new Error(`chave nova não reproduz o original: ${item.table}.${u.column} id=${item.id}`);
        if (tryDecryptWithKey(OLD, stored) !== null) throw new Error(`chave antiga ainda abre: ${item.table}.${u.column} id=${item.id}`);
      }
    }
    const reread = await scan(db, { old: OLD, new: NEW }, false);
    result.after = reread.stats;
    const leftovers = reread.stats.reduce((n, s) => n + s.oldKey, 0);
    if (reread.errors.length || leftovers !== 0) {
      result.errors = reread.errors.slice(0, 200);
      throw new Error(`releitura: ${leftovers} valor(es) ainda na chave antiga, ${reread.errors.length} ilegível(is)`);
    }

    if (!opts.commit) {
      await db.query("rollback");
      return {
        ...result, ok: true,
        message: `DRY-RUN ok: ${result.valuesToMigrate} valor(es) em ${result.rowsToUpdate} linha(s) re-cifrados, relidos e conferidos — ROLLBACK feito, nada gravado`,
      };
    }
    await db.query("commit");
    result.committed = true;
  } catch (err) {
    await db.query("rollback").catch(() => {});
    return { ...result, failedAt: phase, message: `${safeMessage(err)} — ROLLBACK, nada foi gravado` };
  } finally {
    await db.end().catch(() => {});
  }

  // ── Pós-commit: conexão nova ──
  const post = await verifyEncryption(connect, opts.newSecret);
  if (!post.ok) {
    return {
      ...result, failedAt: "post-commit", after: post.after, errors: post.errors,
      message: `COMMIT feito, mas a conferência pós-commit falhou: ${post.message}`,
    };
  }
  return {
    ...result, ok: true, after: post.after,
    message: `COMMIT ok: ${result.valuesToMigrate} valor(es) em ${result.rowsToUpdate} linha(s) migrados; conferência por conexão nova ok`,
  };
}
