import { mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

/**
 * Prints do Estruturar: um PNG por etapa em /opt/scalemaster/vps/prints/<job>/<etapa>.png.
 * O app monta a pasta só para leitura e mostra a miniatura no card
 * (GET /api/vps/estruturacoes/<job>/prints/<etapa>).
 */

export const PASTA_PRINTS = process.env.SCALEMASTER_PRINTS_DIR || "/opt/scalemaster/vps/prints";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ETAPA_RE = /^[a-z0-9-]{1,30}$/;
const VALIDADE_MS = 14 * 24 * 60 * 60_000;

/** Caminho do print, ou null se job/etapa não são nomes seguros. */
export function caminhoDoPrint(jobId, etapa, raiz = PASTA_PRINTS) {
  if (!UUID_RE.test(String(jobId)) || !ETAPA_RE.test(String(etapa))) return null;
  return path.join(raiz, String(jobId).toLowerCase(), `${etapa}.png`);
}

export function salvarPrint(jobId, etapa, png, raiz = PASTA_PRINTS) {
  const arquivo = caminhoDoPrint(jobId, etapa, raiz);
  if (!arquivo || !png?.length) return null;
  mkdirSync(path.dirname(arquivo), { recursive: true, mode: 0o755 });
  writeFileSync(arquivo, png, { mode: 0o644 });
  return arquivo;
}

/** Apaga as pastas de prints paradas há mais de 14 dias. */
export function limparPrintsAntigos(raiz = PASTA_PRINTS, agora = Date.now()) {
  let pastas = [];
  try {
    pastas = readdirSync(raiz, { withFileTypes: true });
  } catch {
    return 0;
  }
  let apagadas = 0;
  for (const p of pastas) {
    if (!p.isDirectory() || !UUID_RE.test(p.name)) continue;
    try {
      if (agora - statSync(path.join(raiz, p.name)).mtimeMs > VALIDADE_MS) {
        rmSync(path.join(raiz, p.name), { recursive: true, force: true });
        apagadas += 1;
      }
    } catch {
      /* sumiu no meio */
    }
  }
  return apagadas;
}
