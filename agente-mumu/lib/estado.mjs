import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Onde fica o que é deste PC: o código (config.json), o log, o PID, os avisos
 * (alertas.json) e as telas desconhecidas (telas/). Fica FORA da pasta
 * agente-mumu: ela vem do git, e quando o repositório é clonado de novo o que
 * estava fora do git vai embora — sem o config.json o agente sai na hora e o
 * botão Iniciar agente da aba Emulador não liga nada.
 */
export const PASTA_ESTADO = path.join(
  process.env.LOCALAPPDATA || path.join(os.homedir(), ".local", "share"),
  "ScaleMaster",
  "agente-mumu"
);

export function arquivoDeEstado(nome) {
  return path.join(PASTA_ESTADO, nome);
}

try {
  mkdirSync(PASTA_ESTADO, { recursive: true });
  // Quem já usava o agente: leva o que estava na pasta antiga (uma vez).
  const antiga = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
  for (const nome of ["config.json", "alertas.json"]) {
    const de = path.join(antiga, nome);
    if (existsSync(de) && !existsSync(arquivoDeEstado(nome))) copyFileSync(de, arquivoDeEstado(nome));
  }
} catch {
  /* sem a pasta, o agente avisa ao tentar ler o código */
}
