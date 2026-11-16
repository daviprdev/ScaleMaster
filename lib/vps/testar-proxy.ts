import http from "node:http";
import net from "node:net";
import tls from "node:tls";

/**
 * Teste de vida das proxies na importação do lote (16/11), direto do servidor
 * (sem redsocks). Mesmas regras do agente (agente-vps/lib/teste-proxy.mjs):
 * generate_204 (fallback robots.txt do Instagram), 25 s por tentativa, mais 2
 * com 5 s de pausa; 407 (ou SOCKS5 recusando usuário/senha) = credencial;
 * recusada = host/porta; 429 = não é culpa da proxy (conta como viva); acima
 * de 6 s = lenta (fica fora do lote). HTTP e SOCKS5 (o nome do destino vai
 * para a proxy resolver, como o socks5h do curl).
 *
 * Depois da vida, o IP e o país de saída (ip-api; 429 dele não conta como
 * morte) e uma segunda leitura do IP (ipify): IP diferente = rotação, a
 * sessão não é fixa.
 */
export const TESTE_URL = "http://www.gstatic.com/generate_204";
export const TESTE_FALLBACK_URL = "https://www.instagram.com/robots.txt";
export const GEO_URL = "http://ip-api.com/json/?fields=status,countryCode,query";
export const IP_URL = "http://api.ipify.org/";
export const TESTE_TIMEOUT_MS = 25_000;
export const GEO_TIMEOUT_MS = 15_000;
export const TESTE_RETENTATIVAS = 2;
export const TESTE_PAUSA_MS = 5_000;
export const LENTA_MS = 6_000;
export const AVISO_ROTACAO_DETECTADA = "rotação detectada, sessão não fixa";

export type EstadoProxy = "viva" | "lenta" | "limitada" | "credencial" | "recusada" | "morta";

export interface ResultadoProxy {
  estado: EstadoProxy;
  motivo: string;
  /** Tempo da tentativa que respondeu (null = nenhuma respondeu). */
  ms: number | null;
  tentativas: number;
  /** IP e país de saída (null = não lidos: proxy fora ou geo limitado). */
  ip?: string | null;
  pais?: string | null;
  /** Duas leituras na mesma sessão deram IPs diferentes. */
  rotacao?: boolean;
  /** Aviso que não tira a proxy do lote (geo limitado, rotação). */
  aviso?: string | null;
}

/** Resultado cru de UMA requisição: resposta HTTP (status, corpo) ou erro de rede (code). */
export type Tentativa = { status: number; ms: number; corpo?: string } | { erro: string; ms: number };

type Classe = "ok" | "credencial" | "limitada" | "recusada" | "morta" | "outro";

const RECUSADA = new Set(["ECONNREFUSED", "ENOTFOUND", "EAI_AGAIN", "EHOSTUNREACH", "ENETUNREACH"]);

/** Classifica uma tentativa (mesma tabela do agente). */
export function classificarTentativa(t: Tentativa): Classe {
  if ("status" in t) {
    if (t.status === 407) return "credencial";
    if (t.status === 429) return "limitada";
    if (t.status === 204 || t.status === 200) return "ok";
    return "outro";
  }
  if (t.erro === "SOCKS_AUTH") return "credencial";
  if (RECUSADA.has(t.erro)) return "recusada";
  return "morta";
}

export const MOTIVO: Record<Exclude<EstadoProxy, "viva" | "lenta">, string> = {
  credencial: "a proxy recusou o usuário/senha (HTTP 407 / SOCKS5)",
  recusada: "conexão recusada ou host inexistente (host/porta errados)",
  morta: "a proxy não respondeu",
  limitada: "o site de teste limitou a proxy (HTTP 429), não é culpa dela",
};

/** Viva, lenta ou limitada: a proxy funciona. Só viva e limitada entram no lote (lenta fica fora, com o motivo). */
export function entraNoLote(estado: EstadoProxy): boolean {
  return estado === "viva" || estado === "limitada";
}

const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface ProxyAlvo {
  tipo: "http" | "socks5";
  host: string;
  porta: number;
  usuario: string;
  senha: string;
}

/** URL gravada (http:// ou socks5h://) → partes. */
export function lerUrlProxy(url: string): ProxyAlvo {
  const u = new URL(url);
  const tipo = /^socks5h?:$/.test(u.protocol) ? "socks5" : "http";
  return { tipo, host: u.hostname, porta: Number(u.port || (tipo === "socks5" ? 1080 : 80)), usuario: decodeURIComponent(u.username), senha: decodeURIComponent(u.password) };
}

function autorizacao(p: ProxyAlvo): Record<string, string> {
  if (!p.usuario) return {};
  return { "Proxy-Authorization": `Basic ${Buffer.from(`${p.usuario}:${p.senha}`).toString("base64")}` };
}

/** Lê bytes de um socket até ter `n` (para o handshake SOCKS5). */
function lerBytes(socket: net.Socket, n: number, buffer: { dados: Buffer }): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const tentar = () => {
      if (buffer.dados.length >= n) {
        const out = buffer.dados.subarray(0, n);
        buffer.dados = buffer.dados.subarray(n);
        socket.off("data", aoChegar);
        socket.off("close", aoFechar);
        resolve(out);
      }
    };
    const aoChegar = (b: Buffer) => {
      buffer.dados = Buffer.concat([buffer.dados, b]);
      tentar();
    };
    const aoFechar = () => reject(Object.assign(new Error("ECONNRESET"), { code: "ECONNRESET" }));
    socket.on("data", aoChegar);
    socket.once("close", aoFechar);
    tentar();
  });
}

/**
 * Túnel SOCKS5 até host:porta com usuário/senha (RFC 1928/1929). O nome vai
 * para a proxy (ATYP 3), então o DNS sai por ela — o socks5h do curl.
 */
export async function tunelSocks5(p: ProxyAlvo, host: string, porta: number): Promise<net.Socket> {
  const socket = net.connect({ host: p.host, port: p.porta });
  await new Promise<void>((resolve, reject) => {
    socket.once("connect", () => resolve());
    socket.once("error", reject);
  });
  const buffer = { dados: Buffer.alloc(0) };
  const comAuth = !!p.usuario;
  socket.write(Buffer.from(comAuth ? [5, 1, 2] : [5, 1, 0]));
  const metodo = await lerBytes(socket, 2, buffer);
  if (metodo[0] !== 5 || metodo[1] === 0xff) throw Object.assign(new Error("SOCKS_AUTH"), { code: comAuth ? "SOCKS_AUTH" : "SOCKS_METODO" });
  if (metodo[1] === 2) {
    const u = Buffer.from(p.usuario);
    const s = Buffer.from(p.senha);
    socket.write(Buffer.concat([Buffer.from([1, u.length]), u, Buffer.from([s.length]), s]));
    const auth = await lerBytes(socket, 2, buffer);
    if (auth[1] !== 0) throw Object.assign(new Error("SOCKS_AUTH"), { code: "SOCKS_AUTH" });
  }
  const nome = Buffer.from(host);
  socket.write(Buffer.concat([Buffer.from([5, 1, 0, 3, nome.length]), nome, Buffer.from([porta >> 8, porta & 0xff])]));
  const resp = await lerBytes(socket, 4, buffer);
  if (resp[1] !== 0) throw Object.assign(new Error(`SOCKS_${resp[1]}`), { code: `SOCKS_${resp[1]}` });
  const resto = resp[3] === 1 ? 4 + 2 : resp[3] === 4 ? 16 + 2 : (await lerBytes(socket, 1, buffer))[0] + 2;
  await lerBytes(socket, resto, buffer);
  if (buffer.dados.length) socket.unshift(buffer.dados);
  return socket;
}

/** Túnel CONNECT por proxy HTTP; status ≠ 200 vem como resposta (407 = credencial). */
function tunelConnect(p: ProxyAlvo, host: string, porta: number): Promise<net.Socket | { status: number }> {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: p.host, port: p.porta, method: "CONNECT", path: `${host}:${porta}`, headers: { Host: `${host}:${porta}`, ...autorizacao(p) } });
    req.on("connect", (res, socket) => (res.statusCode === 200 ? resolve(socket) : (socket.destroy(), resolve({ status: res.statusCode ?? 0 }))));
    req.on("error", reject);
    req.end();
  });
}

/** Resposta crua HTTP/1.0 (sem chunked) → status e corpo. */
function lerResposta(socket: net.Socket | tls.TLSSocket): Promise<{ status: number; corpo: string }> {
  return new Promise((resolve, reject) => {
    let dados = "";
    socket.on("data", (b: Buffer) => (dados += b.toString("latin1")));
    socket.once("error", reject);
    socket.once("close", () => {
      const m = /^HTTP\/\d(?:\.\d)? (\d{3})/.exec(dados);
      if (!m) return reject(Object.assign(new Error("ECONNRESET"), { code: "ECONNRESET" }));
      const corpo = dados.includes("\r\n\r\n") ? dados.slice(dados.indexOf("\r\n\r\n") + 4) : "";
      resolve({ status: Number(m[1]), corpo });
    });
  });
}

/** GET http://… pela proxy HTTP com URI absoluta (o jeito normal de proxy HTTP). */
function pedirPorProxyHttp(p: ProxyAlvo, alvo: URL): Promise<{ status: number; corpo: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: p.host, port: p.porta, method: "GET", path: alvo.href, headers: { Host: alvo.host, ...autorizacao(p), Connection: "close", "User-Agent": "Mozilla/5.0" } },
      (res) => {
        let corpo = "";
        res.setEncoding("utf8");
        res.on("data", (c: string) => {
          if (corpo.length < 8192) corpo += c;
        });
        res.on("end", () => resolve({ status: res.statusCode ?? 0, corpo }));
        res.on("error", reject);
      }
    );
    req.on("error", reject);
    req.end();
  });
}

/**
 * Uma requisição GET pela proxy (HTTP ou SOCKS5), com timeout. Nunca rejeita:
 * devolve { status, corpo } ou { erro }.
 */
export async function pedirPelaProxy(proxyUrl: string, url: string, timeoutMs: number): Promise<Tentativa> {
  const inicio = Date.now();
  const p = lerUrlProxy(proxyUrl);
  const alvo = new URL(url);
  const https = alvo.protocol === "https:";
  const porta = Number(alvo.port || (https ? 443 : 80));
  let aberto: net.Socket | tls.TLSSocket | null = null;
  const trabalho = (async (): Promise<Tentativa> => {
    if (p.tipo === "http" && !https) {
      const r = await pedirPorProxyHttp(p, alvo);
      return { ...r, ms: Date.now() - inicio };
    }
    let socket: net.Socket;
    if (p.tipo === "socks5") socket = await tunelSocks5(p, alvo.hostname, porta);
    else {
      const t = await tunelConnect(p, alvo.hostname, porta);
      if (!(t instanceof net.Socket)) return { status: t.status, ms: Date.now() - inicio };
      socket = t;
    }
    aberto = socket;
    const canal: net.Socket | tls.TLSSocket = https ? tls.connect({ socket, servername: alvo.hostname }) : socket;
    aberto = canal;
    canal.write(`GET ${alvo.pathname}${alvo.search} HTTP/1.0\r\nHost: ${alvo.host}\r\nUser-Agent: Mozilla/5.0\r\nConnection: close\r\n\r\n`);
    const r = await lerResposta(canal);
    return { ...r, ms: Date.now() - inicio };
  })().catch((e: NodeJS.ErrnoException): Tentativa => ({ erro: e.code ?? e.message ?? "ECONNRESET", ms: Date.now() - inicio }));
  let relogio: ReturnType<typeof setTimeout> | undefined;
  const limite = new Promise<Tentativa>((resolve) => {
    relogio = setTimeout(() => resolve({ erro: "ETIMEDOUT", ms: Date.now() - inicio }), timeoutMs);
  });
  const r = await Promise.race([trabalho, limite]);
  clearTimeout(relogio);
  (aberto as net.Socket | null)?.destroy();
  return r;
}

/** Uma tentativa completa: generate_204 e, se ele não der 204/200 (nem 407/429), o fallback. */
export async function tentarUmaVez(proxyUrl: string, timeoutMs = TESTE_TIMEOUT_MS): Promise<Tentativa> {
  const t = await pedirPelaProxy(proxyUrl, TESTE_URL, timeoutMs);
  if (classificarTentativa(t) !== "outro") return t;
  return pedirPelaProxy(proxyUrl, TESTE_FALLBACK_URL, timeoutMs);
}

function detalhe(t: Tentativa): string {
  return "status" in t ? `HTTP ${t.status}` : t.erro;
}

/**
 * Testa a vida de uma proxy com as tentativas e a classificação acima. `tentar`
 * e `pausa` são injetáveis (testes).
 */
export async function testarProxy(
  proxyUrl: string,
  { tentar = tentarUmaVez, pausa = esperar, retentativas = TESTE_RETENTATIVAS, pausaMs = TESTE_PAUSA_MS, timeoutMs = TESTE_TIMEOUT_MS }: { tentar?: (url: string, timeoutMs: number) => Promise<Tentativa>; pausa?: (ms: number) => Promise<unknown>; retentativas?: number; pausaMs?: number; timeoutMs?: number } = {}
): Promise<ResultadoProxy> {
  const total = retentativas + 1;
  let ultima: Tentativa = { erro: "ETIMEDOUT", ms: 0 };
  let ultimaClasse: Classe = "morta";
  for (let n = 1; n <= total; n++) {
    let t: Tentativa;
    try {
      t = await tentar(proxyUrl, timeoutMs);
    } catch {
      t = { erro: "ECONNRESET", ms: 0 };
    }
    const c = classificarTentativa(t);
    if (c === "ok") {
      const lenta = t.ms > LENTA_MS;
      return { estado: lenta ? "lenta" : "viva", motivo: `respondeu em ${(t.ms / 1000).toFixed(1)} s${lenta ? ` (lenta, acima de ${LENTA_MS / 1000} s)` : ""}`, ms: t.ms, tentativas: n };
    }
    if (c === "limitada") return { estado: "limitada", motivo: MOTIVO.limitada, ms: t.ms, tentativas: n };
    // 407 / SOCKS5 recusando a senha é definitivo: repetir não muda a senha.
    if (c === "credencial") return { estado: "credencial", motivo: MOTIVO.credencial, ms: t.ms, tentativas: n };
    ultima = t;
    ultimaClasse = c;
    if (n < total) await pausa(pausaMs);
  }
  const estado: EstadoProxy = ultimaClasse === "recusada" ? "recusada" : "morta";
  return { estado, motivo: `${MOTIVO[estado]} em ${total} tentativas (${detalhe(ultima)})`, ms: null, tentativas: total };
}

/** IP e país de saída pelo ip-api. 429 = { limitado } (não é defeito da proxy). */
export async function lerSaida(proxyUrl: string, pedir: typeof pedirPelaProxy = pedirPelaProxy): Promise<{ ip: string; pais: string } | { limitado: true } | null> {
  const r = await pedir(proxyUrl, GEO_URL, GEO_TIMEOUT_MS);
  if ("erro" in r) return null;
  if (r.status === 429) return { limitado: true };
  if (r.status !== 200) return null;
  try {
    const j = JSON.parse(r.corpo ?? "") as { status?: string; countryCode?: string; query?: string };
    return j.status === "success" && j.query ? { ip: String(j.query), pais: String(j.countryCode ?? "").toUpperCase() } : null;
  } catch {
    return null;
  }
}

/** Só o IP de saída (ipify, texto puro). */
export async function lerIp(proxyUrl: string, pedir: typeof pedirPelaProxy = pedirPelaProxy): Promise<string | null> {
  const r = await pedir(proxyUrl, IP_URL, GEO_TIMEOUT_MS);
  if ("erro" in r || r.status !== 200) return null;
  const ip = String(r.corpo ?? "").trim();
  return /^[0-9a-f.:]{3,45}$/i.test(ip) ? ip : null;
}

/**
 * Teste completo de uma sessão: vida (decide se entra) e, viva, IP/país e a
 * segunda leitura do IP (rotação). Geo limitado ou ilegível nunca derruba.
 */
export async function testarSessao(
  proxyUrl: string,
  { testar = testarProxy, saida = lerSaida, ip = lerIp }: { testar?: (url: string) => Promise<ResultadoProxy>; saida?: (url: string) => ReturnType<typeof lerSaida>; ip?: (url: string) => Promise<string | null> } = {}
): Promise<ResultadoProxy> {
  const vida = await testar(proxyUrl);
  if (vida.estado === "credencial" || vida.estado === "recusada" || vida.estado === "morta") return { ...vida, ip: null, pais: null, rotacao: false, aviso: null };
  const geo = await saida(proxyUrl).catch(() => null);
  const ip1 = geo && "ip" in geo ? geo.ip : await ip(proxyUrl).catch(() => null);
  const pais = geo && "pais" in geo ? geo.pais || null : null;
  const ip2 = ip1 ? await ip(proxyUrl).catch(() => null) : null;
  const rotacao = !!(ip1 && ip2 && ip1 !== ip2);
  const avisos = [geo && "limitado" in geo ? "geo limitado (429): país não lido" : null, rotacao ? `${AVISO_ROTACAO_DETECTADA} (${ip1} → ${ip2})` : null].filter(Boolean);
  return { ...vida, ip: ip1, pais, rotacao, aviso: avisos.length ? avisos.join(" · ") : null };
}

/** Testa várias de uma vez (até `paralelo` ao mesmo tempo), na ordem da lista. */
export async function testarProxies(urls: string[], { paralelo = 25, testar = testarSessao }: { paralelo?: number; testar?: (url: string) => Promise<ResultadoProxy> } = {}): Promise<ResultadoProxy[]> {
  const out: ResultadoProxy[] = new Array(urls.length);
  let proximo = 0;
  const trabalhar = async () => {
    while (proximo < urls.length) {
      const i = proximo++;
      out[i] = await testar(urls[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(paralelo, urls.length) }, trabalhar));
  return out;
}
