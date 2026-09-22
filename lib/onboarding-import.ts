/**
 * onboarding-import.ts - leitura de planilha (CSV/XLSX) para a pagina
 * /dashboard/onboarding. Roda no browser; a validacao definitiva continua
 * sendo a do POST /api/onboarding/jobs (esta so da feedback antes do envio).
 */

import { normalizeInstagramUsername } from "@/lib/onboarding";

export interface OnboardingImportRow {
  line: number; // linha da planilha (1 = cabecalho), para o usuario achar o erro
  username: string;
  password: string;
  proxy_url: string;
  two_factor?: string;
  error: string | null;
}

type Field = "username" | "password" | "proxy_url" | "two_factor";

const HEADER_ALIASES: Record<string, Field> = {
  username: "username", user: "username", usuario: "username", "usuário": "username", conta: "username", login: "username",
  password: "password", senha: "password", pass: "password",
  proxy_url: "proxy_url", proxy: "proxy_url", proxyurl: "proxy_url",
  two_factor: "two_factor", "2fa": "two_factor", totp: "two_factor", twofactor: "two_factor",
};

export const TEMPLATE_CSV =
  "username;password;proxy_url;two_factor\r\n" +
  "exemplo_conta;SenhaForte123;usuario:senha@203.0.113.10:8080;JBSWY3DPEHPK3PXP\r\n";

/** CSV com deteccao de separador (; , ou tab) e aspas no padrao RFC 4180. */
export function parseCsv(text: string): string[][] {
  const clean = text.replace(/^﻿/, "");
  const lines = clean.split(/\r?\n/);
  let start = 0;
  let delimiter = "";
  const sepHint = lines[0]?.match(/^sep=(.)\s*$/i);
  if (sepHint) {
    delimiter = sepHint[1];
    start = 1;
  }
  if (!delimiter) {
    const first = lines.find((l) => l.trim()) ?? "";
    const counts = [";", ",", "\t"].map((d) => [d, first.split(d).length - 1] as const);
    counts.sort((a, b) => b[1] - a[1]);
    delimiter = counts[0][1] > 0 ? counts[0][0] : ";";
  }

  const body = lines.slice(start).join("\n");
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;

  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (quoted) {
      if (ch === '"') {
        if (body[i + 1] === '"') { field += '"'; i++; }
        else quoted = false;
      } else field += ch;
      continue;
    }
    if (ch === '"' && field === "") quoted = true;
    else if (ch === delimiter) { row.push(field); field = ""; }
    else if (ch === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
    else field += ch;
  }
  row.push(field);
  rows.push(row);
  return rows;
}

function cellToString(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString();
  return String(value).trim();
}

/** Converte a matriz da planilha em linhas validadas localmente. */
export function rowsFromMatrix(matrix: unknown[][]): OnboardingImportRow[] {
  const cells = matrix.map((r) => (r ?? []).map(cellToString));
  const headerIdx = cells.findIndex((r) => r.some((c) => c !== ""));
  if (headerIdx < 0) return [];

  const header = cells[headerIdx].map((c) => HEADER_ALIASES[c.toLowerCase().replace(/\s+/g, "_")]);
  const hasHeader = header.includes("username") || header.includes("password");
  // Sem cabecalho reconhecido: assume a ordem do modelo.
  const columns: (Field | undefined)[] = hasHeader
    ? header
    : ["username", "password", "proxy_url", "two_factor"];
  const dataStart = hasHeader ? headerIdx + 1 : headerIdx;

  const seen = new Set<string>();
  const out: OnboardingImportRow[] = [];

  for (let i = dataStart; i < cells.length; i++) {
    const r = cells[i];
    if (!r.some((c) => c !== "")) continue;

    const rec: Partial<Record<Field, string>> = {};
    columns.forEach((col, ci) => {
      if (col && r[ci]) rec[col] = r[ci];
    });

    const username = normalizeInstagramUsername(rec.username ?? "");
    let error: string | null = null;
    if (!username) error = "username inválido (letras, números, . e _, até 30).";
    else if (seen.has(username)) error = "username repetido na planilha.";
    else if (!rec.password) error = "senha vazia.";
    else if (!rec.proxy_url) error = "proxy_url vazio.";
    if (username) seen.add(username);

    out.push({
      line: i + 1,
      username: username ?? (rec.username ?? ""),
      password: rec.password ?? "",
      proxy_url: rec.proxy_url ?? "",
      two_factor: rec.two_factor,
      error,
    });
  }
  return out;
}

export async function readOnboardingFile(file: File): Promise<OnboardingImportRow[]> {
  const name = file.name.toLowerCase();
  if (name.endsWith(".xlsx")) {
    const { readSheet } = await import("read-excel-file/universal");
    const data = await readSheet(file);
    return rowsFromMatrix(data as unknown[][]);
  }
  if (name.endsWith(".csv") || name.endsWith(".txt")) {
    return rowsFromMatrix(parseCsv(await file.text()));
  }
  throw new Error("Formato não suportado. Envie .csv ou .xlsx (o .xls antigo não é aceito).");
}
