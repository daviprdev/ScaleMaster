import { execFile } from "node:child_process";

/**
 * Roda um executável SEM shell (argumentos em lista: nada do servidor vira
 * comando de terminal) e devolve código, stdout e stderr — nunca rejeita.
 */
export function rodar(arquivo, args, { timeoutMs = 60_000, binario = false } = {}) {
  return new Promise((resolve) => {
    execFile(
      arquivo,
      args.map(String),
      {
        windowsHide: true,
        timeout: timeoutMs,
        maxBuffer: 64 * 1024 * 1024,
        encoding: binario ? "buffer" : "utf8",
      },
      (err, stdout, stderr) => {
        resolve({
          codigo: err ? (typeof err.code === "number" ? err.code : -1) : 0,
          estourou: !!err?.killed,
          stdout,
          stderr: Buffer.isBuffer(stderr) ? stderr.toString("utf8") : stderr,
        });
      }
    );
  });
}

export const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

/** Primeiras linhas de uma saída, para mensagem de erro. */
export function trecho(texto, max = 200) {
  return String(texto ?? "").replace(/\s+/g, " ").trim().slice(0, max);
}
