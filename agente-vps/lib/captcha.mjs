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
 * Chave: CAPSOLVER_KEY no ambiente ou `capsolverKey` no config.json.
 * Tipo que não dá para mandar (reCAPTCHA, slider) → quem chama cai no prompt
 * manual.
 */

const ARQ_CONFIG = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "config.json");
const URL_PADRAO = "https://api.capsolver.com";
export const LARGURA = 1080;
export const ALTURA = 1920;

export function chave() {
  if (process.env.CAPSOLVER_KEY) return process.env.CAPSOLVER_KEY;
  try {
    return JSON.parse(readFileSync(ARQ_CONFIG, "utf8")).capsolverKey ?? null;
  } catch {
    return null;
  }
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

/**
 * Manda o PNG e devolve as coordenadas a tocar. `instrucao` = o texto da tela
 * ("Clique nas imagens com …"), que ajuda o resolvedor.
 */
export async function resolver(screenshotPng, { instrucao = "", escala = 1, timeoutMs = 120_000, log = () => {} } = {}) {
  const key = chave();
  if (!key) throw new CaptchaNaoSuportado("CAPSOLVER_KEY não configurada");
  const corpo = new URLSearchParams({
    key,
    method: "base64",
    coordinatescaptcha: "1",
    body: Buffer.from(screenshotPng).toString("base64"),
    textinstructions: instrucao.slice(0, 140),
    json: "0",
  });
  const envio = await fetch(`${base()}/in.php`, { method: "POST", body: corpo, signal: AbortSignal.timeout(30_000) });
  const resposta = (await envio.text()).trim();
  if (!resposta.startsWith("OK|")) {
    if (/ERROR_ZERO_BALANCE|ERROR_KEY|ERROR_WRONG_USER_KEY/.test(resposta)) throw new Error(`Capsolver: ${resposta}`);
    throw new CaptchaNaoSuportado(`Capsolver recusou: ${resposta}`);
  }
  const id = resposta.slice(3);
  log(`captcha enviado (${id})`);

  const limite = Date.now() + timeoutMs;
  while (Date.now() < limite) {
    await esperar(5000);
    const r = await fetch(`${base()}/res.php?${new URLSearchParams({ key, action: "get", id })}`, { signal: AbortSignal.timeout(30_000) });
    const texto = (await r.text()).trim();
    if (texto === "CAPCHA_NOT_READY" || texto === "CAPTCHA_NOT_READY") continue;
    const pontos = lerCoordenadas(texto, escala);
    if (pontos) return pontos;
    if (/ERROR_CAPTCHA_UNSOLVABLE/.test(texto)) throw new CaptchaNaoSuportado("o Capsolver não resolveu a imagem");
    throw new Error(`Capsolver: ${texto}`);
  }
  throw new Error("o Capsolver não respondeu a tempo");
}

/** Toca em cada ponto devolvido, com uma pausa curta entre eles. */
export async function tocarPontos(d, pontos) {
  for (const p of pontos) {
    await d.tocar(Math.min(LARGURA - 1, Math.max(0, p.x)), Math.min(ALTURA - 1, Math.max(0, p.y)));
    await esperar(600);
  }
}
