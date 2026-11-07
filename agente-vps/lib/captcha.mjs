import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { esperar } from "./processo.mjs";

/**
 * Captcha de imagem do Instagram ("Confirma que és uma pessoa": clicar nas
 * imagens certas) resolvido pelo Capsolver na API compatível com a 2captcha:
 * POST in.php (method=base64, coordinatescaptcha=1) → id; GET res.php até
 * "OK|coordinates:x=..,y=..;..." . As coordenadas voltam em pixels da imagem
 * enviada (o print inteiro em 1080x1920, fator 1) e viram toques.
 *
 * Chave: `capsolverKey` no config.json (opcional; CAPSOLVER_KEY no ambiente
 * também vale). `resolver` nunca lança: sem chave, tipo que o Capsolver não
 * aceita, resposta desconhecida, erro de rede ou timeout (45 s, uma
 * retentativa) devolvem null, e quem chama cai no prompt manual.
 */

const ARQ_CONFIG = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "config.json");
const URL_PADRAO = "https://api.capsolver.com";
export const LARGURA = 1080;
export const ALTURA = 1920;

export function chave() {
  try {
    const doConfig = JSON.parse(readFileSync(ARQ_CONFIG, "utf8")).capsolverKey;
    if (doConfig) return String(doConfig);
  } catch {
    /* sem config: só o ambiente */
  }
  return process.env.CAPSOLVER_KEY || null;
}

function base() {
  try {
    return String(JSON.parse(readFileSync(ARQ_CONFIG, "utf8")).capsolverUrl || URL_PADRAO).replace(/\/+$/, "");
  } catch {
    return URL_PADRAO;
  }
}

/** "OK|coordinates:x=120,y=340;x=400,y=500" → [{x,y}], já na resolução fixa (escala = tamanho enviado / 1080). */
export function lerCoordenadas(texto, escala = 1) {
  const m = /^OK\|coordinates:(.+)$/.exec(String(texto).trim());
  if (!m) return null;
  const pontos = [];
  for (const par of m[1].split(";")) {
    const x = /x=(\d+)/.exec(par)?.[1];
    const y = /y=(\d+)/.exec(par)?.[1];
    if (x !== undefined && y !== undefined) pontos.push({ x: Math.round(Number(x) / escala), y: Math.round(Number(y) / escala) });
  }
  return pontos.length > 0 ? pontos : null;
}

export class CaptchaNaoSuportado extends Error {}

export const TIMEOUT_MS = 45_000;

/** Uma tentativa: null quando o Capsolver recusa, responde algo desconhecido ou estoura o tempo. */
async function tentar(screenshotPng, key, { instrucao, escala, timeoutMs, pausaMs, fetchImpl, log }) {
  const corpo = new URLSearchParams({
    key,
    method: "base64",
    coordinatescaptcha: "1",
    body: Buffer.from(screenshotPng).toString("base64"),
    textinstructions: instrucao.slice(0, 140),
    json: "0",
  });
  const limite = Date.now() + timeoutMs;
  const envio = await fetchImpl(`${base()}/in.php`, { method: "POST", body: corpo, signal: AbortSignal.timeout(timeoutMs) });
  const resposta = (await envio.text()).trim();
  if (!resposta.startsWith("OK|")) {
    log(`captcha: Capsolver recusou (${resposta.slice(0, 80)})`);
    return null;
  }
  const id = resposta.slice(3);
  log(`captcha enviado (${id})`);
  while (Date.now() < limite) {
    await esperar(pausaMs);
    const r = await fetchImpl(`${base()}/res.php?${new URLSearchParams({ key, action: "get", id })}`, { signal: AbortSignal.timeout(Math.max(1000, limite - Date.now())) });
    const texto = (await r.text()).trim();
    if (texto === "CAPCHA_NOT_READY" || texto === "CAPTCHA_NOT_READY") continue;
    const pontos = lerCoordenadas(texto, escala);
    if (pontos) return pontos;
    log(`captcha: resposta desconhecida do Capsolver (${texto.slice(0, 80)})`);
    return null;
  }
  log("captcha: o Capsolver não respondeu em 45 s");
  return null;
}

/**
 * Manda o PNG e devolve as coordenadas a tocar, ou null (sem chave, tipo que
 * não é grade de imagem, resposta desconhecida, erro ou timeout; uma
 * retentativa antes de desistir). Nunca lança. `instrucao` = o texto da tela.
 */
export async function resolver(screenshotPng, opcoes = {}) {
  const { instrucao = "", escala = 1, timeoutMs = TIMEOUT_MS, pausaMs = 5000, fetchImpl = fetch, log = () => {} } = opcoes;
  const key = "chave" in opcoes ? opcoes.chave : chave();
  if (!key) {
    log("captcha: capsolverKey não configurada no config.json");
    return null;
  }
  for (let tentativa = 1; tentativa <= 2; tentativa++) {
    try {
      const pontos = await tentar(screenshotPng, key, { instrucao, escala, timeoutMs, pausaMs, fetchImpl, log });
      if (pontos) return pontos;
    } catch (e) {
      log(`captcha: ${e.message}`);
    }
  }
  return null;
}

/** Toca em cada ponto devolvido, com uma pausa curta entre eles. */
export async function tocarPontos(d, pontos) {
  for (const p of pontos) {
    await d.tocar(Math.min(LARGURA - 1, Math.max(0, p.x)), Math.min(ALTURA - 1, Math.max(0, p.y)));
    await esperar(600);
  }
}
