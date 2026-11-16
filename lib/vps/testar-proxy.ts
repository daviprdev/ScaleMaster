import http from "node:http";
import tls from "node:tls";

/**
 * Teste de vida das proxies na importação do lote (16/11), direto do servidor
 * (sem redsocks, sem endpoint de geo — ip-api/ipinfo limitam e não decidem
 * vida). Mesmas regras do agente (agente-vps/lib/teste-proxy.mjs):
 * generate_204 (fallback robots.txt do Instagram), 25 s por tentativa, mais 2
 * com 5 s de pausa; 407 = credencial; recusada = host/porta; 429 = não é culpa
 * da proxy (conta como viva); acima de 6 s = lenta (fica fora do lote).
 */
export const TESTE_URL = "http://www.gstatic.com/generate_204";
export const TESTE_FALLBACK = { host: "www.instagram.com", path: "/robots.txt" };
export const TESTE_TIMEOUT_MS = 25_000;
export const TESTE_RETENTATIVAS = 2;
export const TESTE_PAUSA_MS = 5_000;
export const LENTA_MS = 6_000;

export type EstadoProxy = "viva" | "lenta" | "limitada" | "credencial" | "recusada" | "morta";

export interface ResultadoProxy {
  estado: EstadoProxy;
  motivo: string;
  /** Tempo da tentativa que respondeu (null = nenhuma respondeu). */
  ms: number | null;
  tentativas: number;
}

/** Resultado cru de UMA tentativa: resposta HTTP (status) ou erro de rede (code). */
export type Tentativa = { status: number; ms: number } | { erro: string; ms: number };

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
  if (RECUSADA.has(t.erro)) return "recusada";
  return "morta";
}

export const MOTIVO: Record<Exclude<EstadoProxy, "viva" | "lenta">, string> = {
  credencial: "a proxy recusou o usuário/senha (HTTP 407)",
  recusada: "conexão recusada ou host inexistente (host/porta errados)",
  morta: "a proxy não respondeu",
  limitada: "o site de teste limitou a proxy (HTTP 429), não é culpa dela",
};

/** Viva, lenta ou limitada: a proxy funciona. Só viva e limitada entram no lote (lenta fica fora, com o motivo). */
export function entraNoLote(estado: EstadoProxy): boolean {
  return estado === "viva" || estado === "limitada";
}

const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms));

function autorizacao(proxy: URL): Record<string, string> {
  if (!proxy.username) return {};
  const cred = `${decodeURIComponent(proxy.username)}:${decodeURIComponent(proxy.password)}`;
  return { "Proxy-Authorization": `Basic ${Buffer.from(cred).toString("base64")}` };
}

/** GET http://… pela proxy (proxy HTTP com URI absoluta). */
function pedirHttp(proxy: URL, alvo: string, timeoutMs: number): Promise<Tentativa> {
  const inicio = Date.now();
  return new Promise((resolve) => {
    let feito = false;
    const fim = (t: Tentativa) => {
      if (feito) return;
      feito = true;
      clearTimeout(relogio);
      resolve(t);
    };
    const u = new URL(alvo);
    const req = http.request({ host: proxy.hostname, port: Number(proxy.port || 80), method: "GET", path: alvo, headers: { Host: u.host, ...autorizacao(proxy), Connection: "close" } }, (res) => {
      res.resume();
      fim({ status: res.statusCode ?? 0, ms: Date.now() - inicio });
      req.destroy();
    });
    const relogio = setTimeout(() => {
      fim({ erro: "ETIMEDOUT", ms: Date.now() - inicio });
      req.destroy();
    }, timeoutMs);
    req.on("error", (e: NodeJS.ErrnoException) => fim({ erro: e.code ?? "ECONNRESET", ms: Date.now() - inicio }));
    req.end();
  });
}

/** GET https://host/path por CONNECT + TLS (o fallback). */
function pedirHttps(proxy: URL, host: string, path: string, timeoutMs: number): Promise<Tentativa> {
  const inicio = Date.now();
  return new Promise((resolve) => {
    let feito = false;
    let socketTls: tls.TLSSocket | null = null;
    const fim = (t: Tentativa) => {
      if (feito) return;
      feito = true;
      clearTimeout(relogio);
      socketTls?.destroy();
      req.destroy();
      resolve(t);
    };
    const req = http.request({ host: proxy.hostname, port: Number(proxy.port || 80), method: "CONNECT", path: `${host}:443`, headers: { Host: `${host}:443`, ...autorizacao(proxy) } });
    const relogio = setTimeout(() => fim({ erro: "ETIMEDOUT", ms: Date.now() - inicio }), timeoutMs);
    req.on("connect", (res, socket) => {
      if (res.statusCode !== 200) return fim({ status: res.statusCode ?? 0, ms: Date.now() - inicio });
      socketTls = tls.connect({ socket, servername: host }, () => {
        socketTls?.write(`GET ${path} HTTP/1.1\r\nHost: ${host}\r\nConnection: close\r\nUser-Agent: Mozilla/5.0\r\n\r\n`);
      });
      let dados = "";
      socketTls.on("data", (b: Buffer) => {
        dados += b.toString("latin1");
        const m = /^HTTP\/\d\.\d (\d{3})/.exec(dados);
        if (m) fim({ status: Number(m[1]), ms: Date.now() - inicio });
      });
      socketTls.on("error", (e: NodeJS.ErrnoException) => fim({ erro: e.code ?? "ECONNRESET", ms: Date.now() - inicio }));
      socketTls.on("end", () => fim({ erro: "ECONNRESET", ms: Date.now() - inicio }));
    });
    req.on("error", (e: NodeJS.ErrnoException) => fim({ erro: e.code ?? "ECONNRESET", ms: Date.now() - inicio }));
    req.end();
  });
}

/** Uma tentativa completa: generate_204 e, se ele não der 204/200 (nem 407/429), o fallback. */
export async function tentarUmaVez(proxyUrl: string, timeoutMs = TESTE_TIMEOUT_MS): Promise<Tentativa> {
  const proxy = new URL(proxyUrl);
  const t = await pedirHttp(proxy, TESTE_URL, timeoutMs);
  if (classificarTentativa(t) !== "outro") return t;
  return pedirHttps(proxy, TESTE_FALLBACK.host, TESTE_FALLBACK.path, timeoutMs);
}

function detalhe(t: Tentativa): string {
  return "status" in t ? `HTTP ${t.status}` : t.erro;
}

/**
 * Testa uma proxy com as tentativas e a classificação acima. `tentar` e `pausa`
 * são injetáveis (testes).
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
    if (c === "credencial") return { estado: "credencial", motivo: MOTIVO.credencial, ms: t.ms, tentativas: n };
    ultima = t;
    ultimaClasse = c;
    if (n < total) await pausa(pausaMs);
  }
  const estado: EstadoProxy = ultimaClasse === "recusada" ? "recusada" : "morta";
  return { estado, motivo: `${MOTIVO[estado]} em ${total} tentativas (${detalhe(ultima)})`, ms: null, tentativas: total };
}

/** Testa várias de uma vez (até `paralelo` ao mesmo tempo), na ordem da lista. */
export async function testarProxies(urls: string[], { paralelo = 25, testar = testarProxy }: { paralelo?: number; testar?: (url: string) => Promise<ResultadoProxy> } = {}): Promise<ResultadoProxy[]> {
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
