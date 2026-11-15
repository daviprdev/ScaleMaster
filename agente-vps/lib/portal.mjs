import { createRequire } from "node:module";
import { request as httpsRequest } from "node:https";
import { request as httpRequest } from "node:http";
import { rodar, esperar } from "./processo.mjs";

/**
 * Provedor "portal" (hstockplus → hridoyhub.shop/OTP): o dono compra códigos
 * de resgate e cada um abre uma sessão de 20 min com um @gmail.com; o OTP
 * aparece na própria página. Descoberta em 2026-11-08 (curl, sem Cloudflare,
 * sem cookie):
 *   POST <link> code=<CÓDIGO>         → 302 /OTP/<CÓDIGO> (404 "Invalid code" se não existe)
 *   GET  /OTP/<CÓDIGO>                → HTML com <div class='addr' id='email'>endereço</div>
 *   GET  /OTP/<CÓDIGO>/status         → JSON { ok, lease:[email, inicio, fim], remaining_sec,
 *                                        status:"active"|"expired", time_up, has_otp,
 *                                        can_reactivate, mails:[{ id, otp, subject, virtual, previous_session, … }] }
 *   POST /OTP/<CÓDIGO>/reactivate     → JSON { ok } ({ lease, reason }) — sessão nova, mesmo código,
 *                                        só sem OTP recebido.
 *
 * Interface única nos dois caminhos (PORTAL_MODO=http|browser no .env do agente):
 *   abrir(link, codigo) → { sessao, email }; esperarOtp(sessao, timeoutMs) → código;
 *   renovar(sessao) → e-mail novo; fechar(sessao) — sempre, inclusive em erro.
 * O caminho browser usa o playwright-core de /opt/scalemaster/portal (instalar.sh) ligado
 * por CDP a um Chromium isolado em container (scalemaster-portal-chrome).
 */

export const PORTAL_PADRAO = "https://hridoyhub.shop/OTP/";
export const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";
export const SESSAO_MS = 20 * 60_000;
const CODIGO_RE = /^[A-Za-z0-9]{6,12}$/;
const OTP_RE = /(?<!\d)(\d{6})(?!\d)/;
const PORTAL_DIR = process.env.PORTAL_DIR || "/opt/scalemaster/portal";
const CHROME_CONTAINER = "scalemaster-portal-chrome";
const CHROME_IMAGEM = process.env.PORTAL_CHROME_IMAGEM || "zenika/alpine-chrome:124";
const CDP_URL = process.env.PORTAL_CDP || "http://127.0.0.1:9222";

export function modoPortal(env = process.env) {
  return String(env.PORTAL_MODO ?? "http").trim().toLowerCase() === "browser" ? "browser" : "http";
}

/** "SUDXHRAY" → "SU****AY": o código de resgate nunca sai inteiro no log. */
export function mascarar(codigo) {
  const c = String(codigo ?? "");
  if (c.length <= 4) return "*".repeat(c.length);
  return `${c.slice(0, 2)}${"*".repeat(c.length - 4)}${c.slice(-2)}`;
}

export function codigoValido(codigo) {
  return CODIGO_RE.test(String(codigo ?? ""));
}

/** URL da sessão: <origem do link>/OTP/<CÓDIGO> (o link pode vir com ou sem barra final). */
export function urlSessao(link, codigo) {
  const base = new URL(link);
  const caminho = base.pathname.replace(/\/+$/, "");
  return `${base.origin}${caminho}/${encodeURIComponent(String(codigo).toUpperCase())}`;
}

/** Endereço no HTML da inbox (<div class='addr' id='email'>x@gmail.com</div>); null se não há. */
export function extrairEmail(html) {
  const texto = String(html ?? "");
  const porId = /id=["']email["'][^>]*>\s*([^<\s]+@[^<\s]+)\s*</i.exec(texto)?.[1];
  if (porId) return porId.trim().toLowerCase();
  const porClasse = /class=["']addr["'][^>]*>\s*([^<\s]+@[^<\s]+)\s*</i.exec(texto)?.[1];
  return porClasse ? porClasse.trim().toLowerCase() : null;
}

/**
 * Código de 6 dígitos a partir do /status (objeto) ou do HTML da inbox.
 * No JSON: a mensagem mais nova com `otp` que não seja virtual nem de sessão
 * anterior; sem `otp`, 6 dígitos no assunto. No HTML: #breeze-code, .otp-mini /
 * .otp-preview, e por fim o assunto de uma mail-card.
 */
/**
 * @param {any} fonte objeto do /status ou HTML da inbox
 * @param {Set<string>|null} [ignorar] ids de mensagens antigas
 */
export function extrairOtp(fonte, ignorar = null) {
  if (fonte && typeof fonte === "object") {
    const mails = Array.isArray(fonte.mails) ? fonte.mails : [];
    // `ignorar` = ids que já estavam na caixa antes de o Instagram mandar o código desta vez (OTP velho não vale).
    const validas = mails.filter((m) => m && !m.virtual && !m.previous_session && !(ignorar && m.id && ignorar.has(String(m.id))));
    for (const m of validas.slice().reverse()) {
      const otp = String(m.otp ?? "").trim();
      if (/^\d{4,8}$/.test(otp)) return otp;
      const noAssunto = OTP_RE.exec(String(m.subject ?? ""))?.[1];
      if (noAssunto) return noAssunto;
    }
    return null;
  }
  const html = String(fonte ?? "");
  const breeze = /id=["']breeze-code["'][^>]*>\s*(\d{4,8})\s*</i.exec(html)?.[1];
  if (breeze) return breeze;
  const mini = /class=["'](?:otp-mini|otp-preview)["'][^>]*>(?:[^<\d]*<b>)?\s*(\d{4,8})\s*</i.exec(html)?.[1];
  if (mini) return mini;
  const assunto = /class=["']subject["'][^>]*>([^<]*)</i.exec(html)?.[1];
  return assunto ? (OTP_RE.exec(assunto)?.[1] ?? null) : null;
}

/** Página "Start OTP session →" de um código ainda não iniciado (form post sem campo). */
export function precisaIniciar(html) {
  const texto = String(html ?? "");
  return !extrairEmail(texto) && /Start (the )?(OTP )?session|is ready. Start the session/i.test(texto) && /<form[^>]*method=['"]post['"]/i.test(texto);
}

/** Sessão a partir do /status: e-mail, fim e se já acabou. */
export function lerStatus(j) {
  const lease = Array.isArray(j?.lease) ? j.lease : [];
  const email = typeof lease[0] === "string" && lease[0].includes("@") ? lease[0].toLowerCase() : null;
  const restante = Number.isFinite(Number(j?.remaining_sec)) ? Math.max(0, Number(j.remaining_sec)) : null;
  const acabou = !!j?.time_up || String(j?.status ?? "").toLowerCase() === "expired" || restante === 0;
  return { email, restanteMs: restante === null ? null : restante * 1000, acabou, temOtp: !!j?.has_otp, podeRenovar: !!j?.can_reactivate, lease };
}

// ---------------------------------------------------------------- caminho HTTP

/** Cookie jar mínimo por host (o portal não usa cookie hoje, mas o jar fica para quando usar). */
export class CookieJar {
  constructor() {
    this.cookies = new Map();
  }
  guardar(host, setCookie) {
    for (const linha of Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : []) {
      const [par] = String(linha).split(";");
      const i = par.indexOf("=");
      if (i <= 0) continue;
      this.cookies.set(`${host}|${par.slice(0, i).trim()}`, par.slice(i + 1).trim());
    }
  }
  cabecalho(host) {
    const pares = [];
    for (const [chave, valor] of this.cookies) if (chave.startsWith(`${host}|`)) pares.push(`${chave.slice(host.length + 1)}=${valor}`);
    return pares.join("; ");
  }
}

/**
 * decisão (15/11): no máximo 2 requisições ao portal ao mesmo tempo, somando todos os aparelhos. Com 6 contas
 * consultando juntas o portal passava de 30 s e devolvia 502 em série — o próprio agente piorava a lentidão.
 */
const PORTAL_EM_PARALELO = 2;
let portalEmCurso = 0;
const portalFila = [];
function vagaNoPortal() {
  if (portalEmCurso < PORTAL_EM_PARALELO) {
    portalEmCurso += 1;
    return Promise.resolve();
  }
  return new Promise((ok) => portalFila.push(ok));
}
function soltarPortal() {
  const proximo = portalFila.shift();
  if (proximo) proximo();
  else portalEmCurso -= 1;
}

/** Uma requisição com node:https (sem seguir redirect: quem chama decide), na fila de 2 por vez. */
// decisão (13/11): 30 s por requisição — com 6 contas o portal passa de 15 s com frequência.
export async function requisicao(url, opcoes = {}) {
  await vagaNoPortal();
  try {
    return await requisicaoDireta(url, opcoes);
  } finally {
    soltarPortal();
  }
}

function requisicaoDireta(url, { method = "GET", headers = {}, body = null, jar = null, timeoutMs = 30_000 } = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const fazer = u.protocol === "http:" ? httpRequest : httpsRequest;
    const cabecalhos = { "User-Agent": USER_AGENT, Accept: "text/html,application/json;q=0.9,*/*;q=0.8", "Accept-Language": "en-US,en;q=0.9", ...headers };
    const cookie = jar?.cabecalho(u.host);
    if (cookie) cabecalhos.Cookie = cookie;
    if (body !== null) cabecalhos["Content-Length"] = Buffer.byteLength(body);
    const req = fazer({ method, hostname: u.hostname, port: u.port || undefined, path: `${u.pathname}${u.search}`, headers: cabecalhos, timeout: timeoutMs }, (res) => {
      jar?.guardar(u.host, res.headers["set-cookie"]);
      const partes = [];
      res.on("data", (c) => partes.push(c));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(partes).toString("utf8") }));
      res.on("error", reject);
    });
    req.on("timeout", () => req.destroy(new Error(`o portal demorou mais de ${Math.round(timeoutMs / 1000)} s`)));
    req.on("error", reject);
    if (body !== null) req.write(body);
    req.end();
  });
}

async function statusHttp(sessao) {
  const r = await requisicao(`${sessao.url}/status`, { jar: sessao.jar, headers: { Accept: "application/json", "X-Requested-With": "XMLHttpRequest" } });
  if (r.status === 404 || r.status === 410) {
    const e = new Error("código de resgate inválido ou removido (o portal marcou como usado)");
    e.codigoVencido = true;
    throw e;
  }
  if (r.status !== 200) throw new Error(`status do portal devolveu HTTP ${r.status}`);
  let j;
  try {
    j = JSON.parse(r.body);
  } catch {
    throw new Error("o portal não devolveu JSON no /status (markup mudou?)");
  }
  if (!j?.ok) throw new Error(`portal recusou: ${j?.error ?? "sem detalhe"}`);
  return j;
}

async function renovarHttp(sessao) {
  const atual = lerStatus(await statusHttp(sessao));
  const r = await requisicao(`${sessao.url}/reactivate`, {
    method: "POST",
    jar: sessao.jar,
    headers: { "Content-Type": "application/json", Accept: "application/json", "X-Requested-With": "XMLHttpRequest", Referer: sessao.url },
    body: JSON.stringify({ lease: atual.lease, reason: "nototp" }),
  });
  let resposta = null;
  try {
    resposta = JSON.parse(r.body);
  } catch {
    /* sem JSON */
  }
  if (r.status !== 200 || !resposta?.ok) throw erroRenovar(resposta?.error ?? `HTTP ${r.status}`);
}

/**
 * decisão (15/11): "reactivation_limit_reached" é limite TEMPORÁRIO do portal (luana: recusado às 16:27, às 16:45
 * o /status já dava can_reactivate=true). O código continua valendo: não é vencido. Marca reativacaoLimitada para
 * a caixa parar de insistir (6 tentativas seguravam o aparelho 7 min) e a conta parar com o motivo; Continuar depois.
 * already_used/removed = código gasto de verdade.
 * @param {string} motivo
 * @returns {Error & { codigoVencido?: boolean, reativacaoLimitada?: boolean }}
 */
export function erroRenovar(motivo) {
  /** @type {Error & { codigoVencido?: boolean, reativacaoLimitada?: boolean }} */
  const e = new Error(`o portal não renovou a sessão: ${motivo}`);
  if (/already_used|removed/i.test(String(motivo))) e.codigoVencido = true;
  else if (/limit/i.test(String(motivo))) e.reativacaoLimitada = true;
  return e;
}

const http = {
  async abrir(link, codigo) {
    const jar = new CookieJar();
    const url = urlSessao(link, codigo);
    // decisão (15/11): consulta o /status ANTES do formulário. Código com sessão já existente não é reenviado pelo
    // form: num código vencido o reenvio marca como usado ("already_used", HTTP 410) e mata a reativação (debora,
    // milena, dandara). Sessão existente: devolve como está e o abrir() reativa (vencida sem OTP) ou usa (ativa).
    const antes = await requisicao(`${url}/status`, { jar, headers: { Accept: "application/json", "X-Requested-With": "XMLHttpRequest" } }).catch(() => null);
    if (antes && (antes.status === 404 || antes.status === 410) && /already_used|removed/i.test(antes.body)) {
      const e = new Error("código de resgate já usado ou removido no portal");
      e.codigoVencido = true;
      throw e;
    }
    if (antes?.status === 200) {
      let j = null;
      try {
        j = JSON.parse(antes.body);
      } catch {
        j = null;
      }
      const estado = String(j?.status ?? "").toLowerCase();
      const lido = j?.ok && ["active", "expired", "done"].includes(estado) ? lerStatus(j) : null;
      if (lido?.email) {
        const existente = { modo: "http", url, jar, codigo: String(codigo).toUpperCase(), fimEm: Date.now() + (lido.restanteMs ?? 0), email: lido.email };
        return { sessao: existente, status: j };
      }
    }
    // Código nunca resgatado: resgate pelo form (POST code=…): 302 para /OTP/<CÓDIGO>.
    const post = await requisicao(link, {
      method: "POST",
      jar,
      headers: { "Content-Type": "application/x-www-form-urlencoded", Referer: link },
      body: new URLSearchParams({ code: String(codigo).toUpperCase() }).toString(),
    });
    if (![200, 302, 303].includes(post.status)) throw new Error(`o portal respondeu HTTP ${post.status} ao resgatar`);
    let pagina = await requisicao(url, { jar });
    if (pagina.status === 404) throw new Error("código de resgate inválido");
    // Sessão vencida: a inbox responde 410 (Gone), mas o /status do código continua de pé com o lease — devolve a
    // sessão como está e o abrir() decide (reativa se venceu sem OTP; código gasto se recebeu). debora/milena, 15/11.
    if (pagina.status === 410) {
      const vencida = { modo: "http", url, jar, codigo: String(codigo).toUpperCase(), fimEm: null, email: null };
      const j = await statusHttp(vencida);
      const lido = lerStatus(j);
      vencida.email = lido.email;
      vencida.fimEm = Date.now() + (lido.restanteMs ?? 0);
      return { sessao: vencida, status: j };
    }
    if (pagina.status !== 200) throw new Error(`a inbox do portal devolveu HTTP ${pagina.status}`);
    // Código nunca usado: a página é "Redeem code X is ready. Start the session to receive OTPs." com um
    // <form method='post'> vazio (visto em 08/11 com o 2º código). O POST começa os 20 min e abre a inbox.
    if (precisaIniciar(pagina.body)) {
      const inicio = await requisicao(url, { method: "POST", jar, headers: { "Content-Type": "application/x-www-form-urlencoded", Referer: url }, body: "" });
      if (![200, 302, 303].includes(inicio.status)) throw new Error(`o portal respondeu HTTP ${inicio.status} ao iniciar a sessão`);
      pagina = await requisicao(url, { jar });
      if (pagina.status !== 200) throw new Error(`a inbox do portal devolveu HTTP ${pagina.status} depois de iniciar a sessão`);
    }
    const sessao = { modo: "http", url, jar, codigo: String(codigo).toUpperCase(), fimEm: null, email: null };
    const emailHtml = extrairEmail(pagina.body);
    const j = await statusHttp(sessao);
    const lido = lerStatus(j);
    sessao.email = lido.email ?? emailHtml;
    sessao.fimEm = Date.now() + (lido.restanteMs ?? SESSAO_MS);
    if (!sessao.email) throw new Error("não achei o endereço na inbox do portal (markup mudou?)");
    return { sessao, status: j };
  },
  status: statusHttp,
  renovar: renovarHttp,
  async fechar() {},
};

// ------------------------------------------------------------- caminho browser

async function garantirChrome(log) {
  const ins = await rodar("docker", ["inspect", "--format", "{{.State.Running}}", CHROME_CONTAINER], { timeoutMs: 20_000 });
  if (ins.codigo === 0 && ins.stdout.trim() === "true") return;
  if (ins.codigo === 0) {
    await rodar("docker", ["start", CHROME_CONTAINER], { timeoutMs: 30_000 });
  } else {
    log?.(`portal: subindo o Chromium isolado (${CHROME_IMAGEM})`);
    const r = await rodar(
      "docker",
      [
        "run", "-d", "--name", CHROME_CONTAINER, "--restart", "unless-stopped", "--memory", "768m", "--shm-size", "256m",
        "-p", "127.0.0.1:9222:9222", CHROME_IMAGEM,
        "--no-sandbox", "--headless=new", "--disable-gpu", "--remote-debugging-address=0.0.0.0", "--remote-debugging-port=9222", "about:blank",
      ],
      { timeoutMs: 120_000 }
    );
    if (r.codigo !== 0) throw new Error(`não subiu o Chromium do portal: ${(r.stderr || r.stdout).trim().slice(0, 200)}`);
  }
  for (let i = 0; i < 20; i++) {
    const ok = await requisicao(`${CDP_URL}/json/version`, { timeoutMs: 3000 }).then((r) => r.status === 200).catch(() => false);
    if (ok) return;
    await esperar(500);
  }
  throw new Error("o Chromium do portal não respondeu no CDP");
}

function playwright() {
  try {
    const exigir = createRequire(`${PORTAL_DIR}/package.json`);
    return exigir("playwright-core");
  } catch {
    throw new Error(`playwright-core não está em ${PORTAL_DIR} (rode scripts/vps/instalar.sh)`);
  }
}

const browser = {
  async abrir(link, codigo, { log } = {}) {
    await garantirChrome(log);
    const { chromium } = playwright();
    const navegador = await chromium.connectOverCDP(CDP_URL, { timeout: 15_000 });
    const contexto = await navegador.newContext({ userAgent: USER_AGENT, locale: "en-US" });
    const sessao = { modo: "browser", url: urlSessao(link, codigo), codigo: String(codigo).toUpperCase(), navegador, contexto, pagina: null, fimEm: null, email: null };
    try {
      const pagina = await contexto.newPage();
      sessao.pagina = pagina;
      await pagina.goto(link, { waitUntil: "domcontentloaded", timeout: 30_000 });
      await pagina.fill("input[name='code']", sessao.codigo, { timeout: 10_000 });
      await Promise.all([pagina.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 30_000 }).catch(() => {}), pagina.click("button[type='submit']")]);
      if (!(await pagina.$("#email")) && precisaIniciar(await pagina.content())) {
        await Promise.all([pagina.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 30_000 }).catch(() => {}), pagina.click("form button.btn-primary")]);
      }
      if (!(await pagina.$("#email"))) throw new Error("o portal não abriu a inbox (código inválido?)");
      const j = await browser.status(sessao);
      const lido = lerStatus(j);
      sessao.email = lido.email ?? extrairEmail(await pagina.content());
      sessao.fimEm = Date.now() + (lido.restanteMs ?? SESSAO_MS);
      if (!sessao.email) throw new Error("não achei o endereço na inbox do portal (markup mudou?)");
      return { sessao, status: j };
    } catch (e) {
      await browser.fechar(sessao);
      throw e;
    }
  },
  async status(sessao) {
    const j = await sessao.pagina.evaluate(async (url) => {
      const r = await fetch(url, { cache: "no-store", headers: { Accept: "application/json" } });
      if (r.status === 404 || r.status === 410) throw new Error("código de resgate inválido ou removido");
      return r.json();
    }, `${sessao.url}/status`);
    if (!j?.ok) throw new Error(`portal recusou: ${j?.error ?? "sem detalhe"}`);
    return j;
  },
  async renovar(sessao) {
    const atual = lerStatus(await browser.status(sessao));
    const j = await sessao.pagina.evaluate(
      async ({ url, lease }) => {
        const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json", "X-Requested-With": "XMLHttpRequest" }, body: JSON.stringify({ lease, reason: "nototp" }) });
        return r.json().catch(() => null);
      },
      { url: `${sessao.url}/reactivate`, lease: atual.lease }
    );
    if (!j?.ok) throw erroRenovar(j?.error ?? "sem resposta");
  },
  async fechar(sessao) {
    await sessao?.contexto?.close().catch(() => {});
    await sessao?.navegador?.close().catch(() => {});
  },
};

// ------------------------------------------------------------------ interface

function caminho(sessaoOuModo) {
  const modo = typeof sessaoOuModo === "string" ? sessaoOuModo : (sessaoOuModo?.modo ?? modoPortal());
  return modo === "browser" ? browser : http;
}

/**
 * Resgata o código e devolve a sessão com o endereço. Sessão vencida sem OTP é
 * renovada na hora (mesmo código, endereço novo); vencida com OTP recebido ou
 * sem renovação = código gasto.
 */
export async function abrir(link, codigo, { modo = modoPortal(), log = () => {} } = {}) {
  if (!codigoValido(codigo)) throw new Error("código de resgate fora do formato (6 a 12 letras/números)");
  const via = caminho(modo);
  const { sessao, status } = await via.abrir(link, codigo, { log });
  let lido = lerStatus(status);
  if (lido.acabou) {
    if (lido.temOtp || !lido.podeRenovar) {
      await via.fechar(sessao);
      const usado = new Error(`o código ${mascarar(codigo)} já foi usado (sessão encerrada${lido.temOtp ? " com OTP recebido" : ""})`);
      usado.codigoVencido = true;
      throw usado;
    }
    log(`portal: sessão de ${mascarar(codigo)} vencida sem OTP, renovando`);
    await renovar(sessao);
    lido = lerStatus(await via.status(sessao));
  }
  log(`portal: sessão aberta para ${mascarar(codigo)} (${Math.round((lido.restanteMs ?? SESSAO_MS) / 60_000)} min)`);
  return { sessao, email: sessao.email };
}

/** Ids das mensagens já na caixa (para ignorar OTPs de uma tentativa anterior). */
export async function mensagensVistas(sessao) {
  const j = await caminho(sessao).status(sessao);
  return new Set((Array.isArray(j?.mails) ? j.mails : []).map((m) => String(m?.id ?? "")).filter(Boolean));
}

/** Espera o OTP aparecer na sessão (polling no /status a cada 3 s); `ignorar` = ids de mensagens antigas. */
/**
 * Espera o OTP aparecer na sessão (polling no /status a cada 3 s). Primeiro só
 * vale mensagem nova (id fora de `ignorar`), por `esperaNovoMs`; depois disso
 * vale a mais nova que ainda não foi digitada (`descartar` = códigos já
 * tentados). Motivo (ig-2, 08/11): o Instagram nem sempre manda outro e-mail
 * quando o cadastro recomeça — o código anterior ainda vale — mas um código já
 * digitado e aceito nunca vale de novo.
 * `sinal` (AbortSignal) interrompe a espera: quem chama viu que a tela do código já passou.
 * @param {{ log?: (m: string) => void, intervaloMs?: number, ignorar?: Set<string>|null, descartar?: Set<string>|null, esperaNovoMs?: number, sinal?: AbortSignal|null }} [opts]
 */
export async function esperarOtp(sessao, timeoutMs = 900_000, { log = () => {}, intervaloMs = 8000, ignorar = null, descartar = null, esperaNovoMs = 60_000, sinal = null, maxForaMs = PORTAL_FORA_MAX_MS } = {}) {
  const via = caminho(sessao);
  const inicio = Date.now();
  // decisão (15/11): tempo com o portal fora do ar não conta no prazo — o OTP chega na caixa mesmo com o site
  // caído e só some se ninguém ler (05:48: 6 códigos perdidos assim, o agente desistiu em 6 min com o portal em 502).
  // O prazo cresce o quanto o portal ficou sem responder, até maxForaMs a mais.
  let limite = inicio + timeoutMs;
  const teto = inicio + timeoutMs + maxForaMs;
  let erros = 0;
  let fora = false;
  const valido = (otp) => otp && !(descartar && descartar.has(String(otp)));
  while (Date.now() < limite) {
    if (sinal?.aborted) throw new Error("espera do OTP interrompida: a tela do código já passou");
    const t0 = Date.now();
    try {
      const j = await via.status(sessao);
      if (erros >= 3) log(`portal voltou depois de ${erros} falhas seguidas`);
      erros = 0;
      fora = false;
      const novo = extrairOtp(j, ignorar);
      if (valido(novo)) return novo;
      if (Date.now() - inicio >= esperaNovoMs) {
        const velho = extrairOtp(j, null);
        if (valido(velho)) {
          log("portal: nenhum e-mail novo, usando o último código ainda não digitado");
          return velho;
        }
      }
      if (lerStatus(j).acabou) throw new Error("a sessão do portal acabou sem o OTP chegar");
    } catch (e) {
      if (/acabou sem o OTP|inválido|removido|interrompida/.test(e.message)) throw e;
      erros += 1;
      fora = true;
      limite = Math.min(teto, limite + (Date.now() - t0) + intervaloMs);
      // Portal lento não encerra a espera: segue consultando até a sessão acabar (13/11: 8 contas desistiram em 90 s).
      if (erros === 1 || erros % 5 === 0) log(`portal: ${e.message} (tentando de novo, ${erros}ª falha seguida; o prazo do OTP espera o portal voltar)`);
    }
    await esperar(intervaloMs);
  }
  if (fora) {
    const e = new Error(`o portal ficou fora do ar e a caixa não pôde ser lida (${Math.round((Date.now() - inicio) / 60_000)} min esperando)`);
    e.portalFora = true;
    throw e;
  }
  throw new Error(`o OTP não chegou no portal em ${Math.round(timeoutMs / 60_000)} min`);
}

/** Quanto o agente espera o portal voltar (fora do ar) antes de desistir da caixa. 15/11: quedas de 7 a 31 min. */
export const PORTAL_FORA_MAX_MS = 40 * 60_000;

/** O portal responde (GET na raiz, sem gastar nada). */
export async function portalNoAr(link) {
  try {
    await verificarPortal(link);
    return true;
  } catch {
    return false;
  }
}

/**
 * Espera o portal voltar antes de qualquer POST (resgate ou Reactivate): POST com o portal em 502/timeout pode
 * valer pela metade no servidor e gastar uma reativação (luana, fabiana, sofia: reactivation_limit_reached).
 * Devolve false se passou de `maxMs` ainda fora.
 * @param {string} link
 * @param {{ maxMs?: number, intervaloMs?: number, log?: (m: string) => void, noAr?: (link: string) => Promise<boolean> }} [opts]
 */
export async function esperarPortalNoAr(link, { maxMs = PORTAL_FORA_MAX_MS, intervaloMs = 20_000, log = () => {}, noAr = portalNoAr } = {}) {
  const inicio = Date.now();
  let avisou = false;
  while (!(await noAr(link))) {
    if (Date.now() - inicio >= maxMs) return false;
    if (!avisou) log("portal fora do ar: esperando ele voltar antes de resgatar/reativar (o código não é gasto)");
    avisou = true;
    await esperar(intervaloMs);
  }
  if (avisou) log(`portal voltou (${Math.round((Date.now() - inicio) / 1000)} s fora)`);
  return true;
}

/** Sessão nova para o mesmo código (endereço novo). Devolve o e-mail novo. */
export async function renovar(sessao) {
  const via = caminho(sessao);
  await via.renovar(sessao);
  for (let i = 0; i < 10; i++) {
    const lido = lerStatus(await via.status(sessao));
    if (lido.email && lido.email !== sessao.email && !lido.acabou) {
      sessao.email = lido.email;
      sessao.fimEm = Date.now() + (lido.restanteMs ?? SESSAO_MS);
      return sessao.email;
    }
    await esperar(1000);
  }
  throw new Error("o portal renovou mas não deu endereço novo");
}

export async function fechar(sessao) {
  if (!sessao) return;
  await caminho(sessao).fechar(sessao).catch(() => {});
}

/**
 * Estado de um código JÁ resgatado (GET /status, sem POST): { email, restanteMs, acabou, temOtp, podeRenovar }.
 * Só para códigos com resgate registrado — num código novo o /status pode iniciar a sessão.
 */
export async function statusDoCodigo(link, codigo) {
  const url = urlSessao(link, codigo);
  const r = await requisicao(`${url}/status`, { headers: { Accept: "application/json", "X-Requested-With": "XMLHttpRequest" } });
  if (r.status === 404 || r.status === 410) return { email: null, restanteMs: 0, acabou: true, temOtp: false, podeRenovar: false, lease: [] };
  if (r.status !== 200) throw new Error(`status do portal devolveu HTTP ${r.status}`);
  return lerStatus(JSON.parse(r.body));
}

/** Só confere que o link é o portal (form com input name=code), sem gastar código. */
export async function verificarPortal(link) {
  const r = await requisicao(link, { timeoutMs: 15_000 });
  if (r.status !== 200) throw new Error(`o portal respondeu HTTP ${r.status}`);
  if (!/name=["']code["']/i.test(r.body)) throw new Error("o link não mostra o form de resgate (Cloudflare ou markup mudou)");
  return true;
}
