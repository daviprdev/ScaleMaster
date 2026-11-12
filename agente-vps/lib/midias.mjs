import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Mídias da VPS para foto de perfil e story: /opt/scalemaster/midias (ou
 * `pastaMidias` no config.json). O agente manda só a lista de nomes para a aba;
 * na hora, copia o arquivo escolhido direto da VPS para o container.
 */

const ARQ_CONFIG = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "config.json");
export const PASTA_PADRAO = "/opt/scalemaster/midias";
const TIPOS = { ".jpg": "imagem", ".jpeg": "imagem", ".png": "imagem", ".webp": "imagem", ".mp4": "video", ".mov": "video" };
const MAX_ARQUIVOS = 500;
const MAX_NIVEIS = 4;

export function tipoDaMidia(nome) {
  return TIPOS[path.extname(nome).toLowerCase()] ?? null;
}

/** Caminho da pasta de mídias, ou null se não existe. */
export async function pastaDeMidias() {
  try {
    const config = JSON.parse(readFileSync(ARQ_CONFIG, "utf8"));
    if (config?.pastaMidias) return existsSync(config.pastaMidias) ? config.pastaMidias : null;
  } catch {
    /* sem config: a padrão */
  }
  return existsSync(PASTA_PADRAO) ? PASTA_PADRAO : null;
}

/** Fotos e vídeos da pasta (subpastas inclusas, sem as ocultas), caminho relativo com "/". */
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
 * Caminho na VPS de uma mídia escolhida na aba. Só aceita arquivo de foto/vídeo
 * DENTRO da pasta de mídias: o SaaS não consegue fazer o agente ler outro arquivo.
 */
export function resolverMidia(raiz, rel) {
  const base = path.resolve(raiz);
  const alvo = path.resolve(base, String(rel));
  if (!alvo.startsWith(base + path.sep) || !tipoDaMidia(alvo)) throw new Error(`Mídia inválida: ${rel}`);
  if (!existsSync(alvo)) throw new Error(`"${rel}" não está mais na pasta de mídias.`);
  return alvo;
}

/** Uma foto de perfil sorteada da subpasta perfil/ das mídias, ou null (sem foto: a criação pula a troca). */
export function sortearFoto(raiz) {
  // Só da subpasta perfil/: sem ela o sorteio pegava qualquer foto da pasta, inclusive a do story (12/11).
  const lista = listarMidias(raiz).filter((m) => m.tipo === "imagem" && m.path.startsWith("perfil/"));
  if (lista.length === 0) return null;
  return path.join(raiz, lista[Math.floor(Math.random() * lista.length)].path);
}
