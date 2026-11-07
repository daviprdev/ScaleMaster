import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";

/**
 * Instagram por APK pinado: /opt/scalemaster/apks/instagram-<versão>.apk
 * (baixado por scripts/vps/instalar.sh ou copiado à mão). Sem Aurora: o
 * container não precisa de internet para instalar, então a etapa roda antes
 * da proxy. Substitui agente-mumu/fluxos/aurora.mjs.
 */

export const INSTAGRAM = "com.instagram.android";
export const PASTA_APKS = "/opt/scalemaster/apks";

/** Versões disponíveis na VPS (nomes instagram-<versão>.apk): a da base (arquivo ATUAL, gravado pelo golden.sh) primeiro, depois da mais nova para a mais velha. */
export function versoesDisponiveis(pasta = PASTA_APKS) {
  if (!existsSync(pasta)) return [];
  const lista = readdirSync(pasta)
    .map((f) => /^instagram-([0-9][0-9A-Za-z.\-_]{0,30})\.apk$/.exec(f)?.[1])
    .filter(Boolean)
    .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
  let atual = null;
  try {
    atual = readFileSync(path.join(pasta, "ATUAL"), "utf8").trim();
  } catch {
    /* sem ATUAL: a ordem por versão */
  }
  return atual && lista.includes(atual) ? [atual, ...lista.filter((v) => v !== atual)] : lista;
}

export function caminhoApk(versao, pasta = PASTA_APKS) {
  if (!/^[0-9][0-9A-Za-z.\-_]{0,30}$/.test(String(versao ?? ""))) throw new Error(`Versão do Instagram inválida: ${versao}`);
  const arquivo = path.join(pasta, `instagram-${versao}.apk`);
  if (!existsSync(arquivo)) throw new Error(`A VPS não tem ${arquivo}. Copie o APK para ${pasta}.`);
  return arquivo;
}

/** versionName do Instagram instalado no aparelho, ou null. */
export async function versaoInstalada(d) {
  if (!(await d.temApp(INSTAGRAM))) return null;
  const saida = await d.shell("dumpsys", "package", INSTAGRAM).catch(() => "");
  return /versionName=([^\s]+)/.exec(saida)?.[1] ?? "?";
}

/** Instala (ou reinstala, se a versão pinada for outra) e devolve a mensagem da etapa. */
export async function instalarInstagram(d, versao, log) {
  const arquivo = caminhoApk(versao);
  const atual = await versaoInstalada(d);
  if (atual && atual.startsWith(String(versao))) return `já estava instalado (${atual})`;
  if (atual) log(`Instagram ${atual} instalado: trocando pelo ${versao}`);
  await d.instalar(arquivo);
  const depois = await versaoInstalada(d);
  if (!depois) throw new Error("O Instagram não apareceu instalado depois do adb install.");
  return `Instagram ${depois} instalado`;
}
