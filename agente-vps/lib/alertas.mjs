import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Avisos por instância que valem até a instância ser usada de novo (ex.: conta
 * travada pedindo telefone). Ficam no PC, em alertas.json, presos ao
 * created_timestamp do MuMu: não somem ao remover o cartão na aba nem ao
 * renomear a instância, e uma instância nova que reaproveite o índice não herda.
 * Vão no retrato de cada sync (campo alert) e a aba mostra em vermelho.
 */

const ARQUIVO = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "alertas.json");

function ler() {
  try {
    const dados = JSON.parse(readFileSync(ARQUIVO, "utf8"));
    return dados && typeof dados === "object" ? dados : {};
  } catch {
    return {};
  }
}

function gravar(dados) {
  writeFileSync(ARQUIVO, `${JSON.stringify(dados, null, 2)}\n`);
}

export function alertaDe(criada) {
  return criada ? (ler()[criada]?.alerta ?? null) : null;
}

export function marcarAlerta(criada, alerta) {
  if (!criada) return;
  const dados = ler();
  dados[criada] = { alerta, em: new Date().toISOString() };
  gravar(dados);
}

export function limparAlerta(criada) {
  if (!criada) return;
  const dados = ler();
  if (!(criada in dados)) return;
  delete dados[criada];
  gravar(dados);
}
