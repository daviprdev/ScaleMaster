import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { abiEsperada, archDe } from "../lib/android.mjs";

/**
 * Instagram por APK pinado em /opt/scalemaster/apks, por arquitetura da VPS:
 *   arm64   instagram-<versão>.apk (um arquivo, adb install -r)
 *   x86_64  x86-<versão>/base.apk + split_config.xxhdpi.apk (adb install-multiple -r),
 *           cada um com o seu .sha256 ao lado, conferido antes de instalar.
 * Sem Aurora: o container não precisa de internet para instalar, então a etapa
 * roda antes da proxy. Substitui agente-mumu/fluxos/aurora.mjs.
 */

export const INSTAGRAM = "com.instagram.android";
export const PASTA_APKS = "/opt/scalemaster/apks";
/** Arquivos do build x86_64 dividido, na ordem do install-multiple. */
export const ARQUIVOS_X86 = ["base.apk", "split_config.xxhdpi.apk"];
const VERSAO_RE = /^[0-9][0-9A-Za-z.\-_]{0,30}$/;

function ordenarComAtual(lista, pasta) {
  const ordenada = [...lista].sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
  let atual = null;
  try {
    atual = readFileSync(path.join(pasta, "ATUAL"), "utf8").trim();
  } catch {
    /* sem ATUAL: a ordem por versão */
  }
  return atual && ordenada.includes(atual) ? [atual, ...ordenada.filter((v) => v !== atual)] : ordenada;
}

/**
 * Versões disponíveis na VPS para esta arquitetura: a da base (arquivo ATUAL,
 * gravado pelo golden.sh) primeiro, depois da mais nova para a mais velha.
 * @param {string} [pasta]
 * @param {string} [arch]
 */
export function versoesDisponiveis(pasta = PASTA_APKS, arch = process.arch) {
  if (!existsSync(pasta)) return [];
  const entradas = readdirSync(pasta);
  if (archDe(arch) === "x86_64") {
    const lista = entradas
      .map((f) => /^x86-([0-9][0-9A-Za-z.\-_]{0,30})$/.exec(f)?.[1])
      .filter((v) => v && existsSync(path.join(pasta, `x86-${v}`, "base.apk")));
    return ordenarComAtual(lista, pasta);
  }
  const lista = entradas.map((f) => /^instagram-([0-9][0-9A-Za-z.\-_]{0,30})\.apk$/.exec(f)?.[1]).filter(Boolean);
  return ordenarComAtual(lista, pasta);
}

/** arm64: caminho do instagram-<versão>.apk. */
export function caminhoApk(versao, pasta = PASTA_APKS) {
  if (!VERSAO_RE.test(String(versao ?? ""))) throw new Error(`Versão do Instagram inválida: ${versao}`);
  const arquivo = path.join(pasta, `instagram-${versao}.apk`);
  if (!existsSync(arquivo)) throw new Error(`A VPS não tem ${arquivo}. Copie o APK para ${pasta}.`);
  return arquivo;
}

/** x86_64: pasta x86-<versão> e os arquivos do build dividido (sem conferir o hash ainda). */
export function arquivosX86(versao, pasta = PASTA_APKS) {
  if (!VERSAO_RE.test(String(versao ?? ""))) throw new Error(`Versão do Instagram inválida: ${versao}`);
  const dir = path.join(pasta, `x86-${versao}`);
  const arquivos = ARQUIVOS_X86.map((n) => path.join(dir, n));
  for (const a of arquivos) if (!existsSync(a)) throw new Error(`A VPS não tem ${a}. Fixe o build x86_64 em ${dir}/.`);
  return arquivos;
}

/** sha256 em hex de um arquivo (streaming não precisa: o APK cabe na memória em 300 MB). */
export function sha256De(arquivo) {
  return createHash("sha256").update(readFileSync(arquivo)).digest("hex");
}

/** Hash gravado em <arquivo>.sha256 (formato do sha256sum: "<hash>  nome"), ou null se não existe. */
export function hashGravado(arquivo) {
  const lado = `${arquivo}.sha256`;
  if (!existsSync(lado)) return null;
  return /^([0-9a-f]{64})/i.exec(readFileSync(lado, "utf8").trim())?.[1]?.toLowerCase() ?? null;
}

/**
 * Confere o sha256 de cada arquivo contra o .sha256 ao lado. Falta o .sha256
 * ou o hash não bate = erro (nada é instalado). Devolve os hashes conferidos.
 */
export function conferirSha256(arquivos) {
  const ok = [];
  for (const a of arquivos) {
    const esperado = hashGravado(a);
    if (!esperado) throw new Error(`Falta ${path.basename(a)}.sha256 ao lado de ${a}: gere com sha256sum antes de instalar.`);
    const lido = sha256De(a);
    if (lido !== esperado) throw new Error(`sha256 de ${path.basename(a)} não bate: esperado ${esperado.slice(0, 12)}…, lido ${lido.slice(0, 12)}… (${statSync(a).size} bytes).`);
    ok.push({ arquivo: a, sha256: lido });
  }
  return ok;
}

/** versionName do Instagram instalado no aparelho, ou null. */
export async function versaoInstalada(d) {
  if (!(await d.temApp(INSTAGRAM))) return null;
  const saida = await d.shell("dumpsys", "package", INSTAGRAM).catch(() => "");
  return /versionName=([^\s]+)/.exec(saida)?.[1] ?? "?";
}

/**
 * Instala (ou reinstala, se a versão pinada ou a ABI for outra) e devolve a
 * mensagem da etapa. Em x86_64: sha256 dos dois arquivos conferido, install-multiple,
 * e o primaryCpuAbi do pacote tem que sair x86_64 (senão ABI_AUSENTE).
 * @param {{ temApp: Function, shell: Function, abiPrimaria: Function, instalar: Function, instalarMultiplos: Function }} d
 * @param {string} versao
 * @param {(m: string) => void} log
 * @param {{ arch?: string, pasta?: string }} [opcoes]
 */
export async function instalarInstagram(d, versao, log, { arch = process.arch, pasta = PASTA_APKS } = {}) {
  const a = archDe(arch);
  const abi = abiEsperada(a);
  const atual = await versaoInstalada(d);
  const abiAtual = atual ? await d.abiPrimaria(INSTAGRAM) : null;
  if (atual && atual.startsWith(String(versao)) && abiAtual === abi) return `já estava instalado (${atual}, ${abi})`;
  if (atual) log(`Instagram ${atual} (${abiAtual || "?"}) instalado: trocando pelo ${versao} ${abi}`);
  if (a === "x86_64") {
    const arquivos = arquivosX86(versao, pasta);
    const hashes = conferirSha256(arquivos);
    log(`sha256 ok: ${hashes.map((h) => `${path.basename(h.arquivo)} ${h.sha256.slice(0, 12)}…`).join(", ")}`);
    if (atual && abiAtual !== abi) await d.shell("pm", "uninstall", INSTAGRAM).catch(() => {});
    await d.instalarMultiplos(arquivos);
  } else {
    await d.instalar(caminhoApk(versao, pasta));
  }
  const depois = await versaoInstalada(d);
  if (!depois) throw new Error("O Instagram não apareceu instalado depois do adb install.");
  const abiDepois = await d.abiPrimaria(INSTAGRAM);
  if (abiDepois !== abi) throw new Error(`ABI_AUSENTE: o Instagram instalou como ${abiDepois || "?"}, esta VPS exige ${abi}.`);
  return `Instagram ${depois} instalado (${abi})`;
}
