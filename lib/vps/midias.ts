import { existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { MIDIA_EXTENSOES, MIDIA_MAX_BYTES } from "./estruturacao";

/**
 * Mídias da VPS (/opt/scalemaster/midias, montada no container do app): a
 * janela Estruturar lista e envia fotos por aqui; o agente lê a mesma pasta.
 * Só servidor.
 */

export function pastaMidias(): string {
  return process.env.VPS_MIDIAS_DIR || "/opt/scalemaster/midias";
}

export function pastaPrints(): string {
  return process.env.VPS_PRINTS_DIR || "/opt/scalemaster/vps/prints";
}

/**
 * Arquivo do print de uma etapa dentro da pasta de prints. O caminho é
 * resolvido e tem que continuar dentro da pasta: qualquer coisa que escape
 * ("..", caminho absoluto, separador) devolve null.
 */
export function caminhoDoPrint(base: string, jobId: string, etapa: string): string | null {
  const raiz = path.resolve(base);
  const alvo = path.resolve(raiz, String(jobId).toLowerCase(), `${etapa}.png`);
  if (!alvo.startsWith(raiz + path.sep)) return null;
  // Exatamente <pasta>/<job>/<etapa>.png: nem outro nível, nem a pasta de outro job (etapa "../outro-job/foto").
  const pastaDoJob = path.join(raiz, String(jobId).toLowerCase());
  if (path.dirname(pastaDoJob) !== raiz || path.dirname(alvo) !== pastaDoJob) return null;
  return alvo;
}

export interface MidiaArquivo {
  path: string;
  size: number;
}

/** Fotos da pasta (subpastas até 3 níveis, sem as ocultas), caminho relativo com "/". */
export function listarMidias(raiz: string): MidiaArquivo[] {
  const arquivos: MidiaArquivo[] = [];
  const visitar = (pasta: string, nivel: number) => {
    if (nivel > 3 || arquivos.length >= 500) return;
    let itens: import("node:fs").Dirent[] = [];
    try {
      itens = readdirSync(path.join(raiz, pasta), { withFileTypes: true });
    } catch {
      return;
    }
    for (const item of itens.sort((a, b) => a.name.localeCompare(b.name))) {
      if (item.name.startsWith(".") || arquivos.length >= 500) continue;
      const rel = pasta ? `${pasta}/${item.name}` : item.name;
      if (item.isDirectory()) visitar(rel, nivel + 1);
      else if (item.isFile() && MIDIA_EXTENSOES.includes(path.extname(item.name).toLowerCase())) {
        try {
          arquivos.push({ path: rel, size: statSync(path.join(raiz, rel)).size });
        } catch {
          /* sumiu no meio */
        }
      }
    }
  };
  visitar("", 0);
  return arquivos;
}

/** Nome de arquivo seguro: sem pasta, sem acento, só [a-z0-9._-], extensão em minúsculas. null = extensão não aceita. */
export function nomeSeguro(nome: string): string | null {
  const base = path.basename(String(nome).replace(/\\/g, "/"));
  const ext = path.extname(base).toLowerCase();
  if (!MIDIA_EXTENSOES.includes(ext)) return null;
  const miolo = base
    .slice(0, base.length - ext.length)
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "")
    .slice(0, 60);
  return `${miolo || "foto"}${ext}`;
}

/** O conteúdo é mesmo jpg, png ou webp (assinatura do arquivo)? */
export function tipoPelosBytes(bytes: Uint8Array): "jpg" | "png" | "webp" | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "jpg";
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "png";
  if (bytes.length >= 12 && String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" && String.fromCharCode(...bytes.slice(8, 12)) === "WEBP") return "webp";
  return null;
}

/**
 * Grava o upload na pasta de mídias: até 8 MB, jpg/png/webp (extensão e
 * conteúdo), nome sanitizado e sem sobrescrever (foto.jpg → foto-2.jpg).
 */
export function salvarMidia(raiz: string, nome: string, bytes: Uint8Array): { path: string } | { error: string } {
  const seguro = nomeSeguro(nome);
  if (!seguro) return { error: "Só jpg, png ou webp." };
  if (bytes.length === 0) return { error: "Arquivo vazio." };
  if (bytes.length > MIDIA_MAX_BYTES) return { error: "A foto passa de 8 MB." };
  const tipo = tipoPelosBytes(bytes);
  const ext = path.extname(seguro);
  if (!tipo || (tipo === "jpg" ? ![".jpg", ".jpeg"].includes(ext) : ext !== `.${tipo}`)) {
    return { error: "O conteúdo do arquivo não é uma imagem jpg, png ou webp." };
  }
  mkdirSync(raiz, { recursive: true });
  const miolo = seguro.slice(0, seguro.length - ext.length);
  let final = seguro;
  for (let n = 2; existsSync(path.join(raiz, final)); n++) final = `${miolo}-${n}${ext}`;
  // flag wx: se outro upload criou o mesmo nome no meio, falha em vez de sobrescrever.
  writeFileSync(path.join(raiz, final), bytes, { flag: "wx", mode: 0o644 });
  return { path: final };
}
