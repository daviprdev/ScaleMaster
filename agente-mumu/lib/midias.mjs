import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { rodar } from "./processo.mjs";

/**
 * Mídias da pasta compartilhada do MuMu no PC (Documentos\MuMuSharedFolder,
 * que pode estar dentro do OneDrive). O agente manda só a lista de nomes para
 * a aba Emulador; na hora de rodar, copia o arquivo escolhido direto do PC para
 * a instância. Outra pasta: campo pastaMidias do config.json.
 */

const ARQ_CONFIG = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "config.json");
const TIPOS = { ".jpg": "imagem", ".jpeg": "imagem", ".png": "imagem", ".mp4": "video", ".mov": "video" };
const MAX_ARQUIVOS = 500;
const MAX_NIVEIS = 4;

export function tipoDaMidia(nome) {
  return TIPOS[path.extname(nome).toLowerCase()] ?? null;
}

/** Pasta Documentos do Windows (a de verdade: com OneDrive ela muda de lugar). */
async function documentos() {
  const chave = "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\User Shell Folders";
  const { stdout } = await rodar("reg", ["query", chave, "/v", "Personal"], { timeoutMs: 15_000 });
  const m = /Personal\s+REG_\w+\s+(.+)$/m.exec(String(stdout));
  return m ? m[1].trim().replace(/%([^%]+)%/g, (_, nome) => process.env[nome] ?? `%${nome}%`) : null;
}

/** Caminho da pasta de mídias, ou null se não achou nenhuma. */
export async function pastaDeMidias() {
  try {
    const config = JSON.parse(readFileSync(ARQ_CONFIG, "utf8"));
    if (config?.pastaMidias) return existsSync(config.pastaMidias) ? config.pastaMidias : null;
  } catch {
    /* sem config: procura */
  }
  const casa = os.homedir();
  const bases = [await documentos().catch(() => null), path.join(casa, "Documents"), path.join(casa, "OneDrive", "Documentos"), path.join(casa, "OneDrive", "Documents")];
  return bases.filter(Boolean).map((b) => path.join(b, "MuMuSharedFolder")).find((p) => existsSync(p)) ?? null;
}

/** Fotos e vídeos da pasta (subpastas inclusas, sem as ocultas como .thumbnails), caminho relativo com "/". */
export function listarMidias(raiz) {
  const arquivos = [];
  const visitar = (pasta, nivel) => {
    if (nivel > MAX_NIVEIS || arquivos.length >= MAX_ARQUIVOS) return;
    let itens = [];
    try {
      itens = readdirSync(path.join(raiz, pasta), { withFileTypes: true });
    } catch {
      return;
    }
    for (const item of itens.sort((a, b) => a.name.localeCompare(b.name))) {
      if (item.name.startsWith(".") || arquivos.length >= MAX_ARQUIVOS) continue;
      const rel = pasta ? `${pasta}/${item.name}` : item.name;
      if (item.isDirectory()) visitar(rel, nivel + 1);
      else if (item.isFile() && tipoDaMidia(item.name)) {
        try {
          arquivos.push({ path: rel, size: statSync(path.join(raiz, rel)).size, tipo: tipoDaMidia(item.name) });
        } catch {
          /* sumiu no meio: pula */
        }
      }
    }
  };
  visitar("", 0);
  return arquivos;
}

/**
 * Caminho no PC de uma mídia escolhida na aba. Só aceita arquivo de foto/vídeo
 * DENTRO da pasta de mídias: o SaaS não consegue fazer o agente ler outro arquivo.
 */
export function resolverMidia(raiz, rel) {
  const base = path.resolve(raiz);
  const alvo = path.resolve(base, String(rel));
  if (!alvo.startsWith(base + path.sep) || !tipoDaMidia(alvo)) throw new Error(`Mídia inválida: ${rel}`);
  if (!existsSync(alvo)) throw new Error(`"${rel}" não está mais na pasta do MuMu.`);
  return alvo;
}
