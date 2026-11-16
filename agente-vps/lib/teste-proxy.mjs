import { esperar, rodar } from "./processo.mjs";

/**
 * Teste de vida da proxy (16/11), direto do host com `curl -x` (http:// ou socks5h://, o DNS sai pela proxy), sem passar pelo
 * redsocks. Endpoint neutro: http://www.gstatic.com/generate_204 (204, sem
 * corpo); se ele não der 204, https://www.instagram.com/robots.txt. Endpoint de
 * geo (ip-api, ipinfo) nunca decide se a proxy está viva — eles limitam (429)
 * e derrubavam conta com proxy boa.
 *
 * 25 s por tentativa e mais 2 tentativas com 5 s de pausa. Classificação:
 *   viva        — respondeu (acima de LENTA_MS = lenta, mas viva)
 *   credencial  — HTTP 407 (usuário/senha errados): não repete
 *   recusada    — conexão recusada ou host que não resolve (host/porta errados)
 *   limitada    — HTTP 429: não é culpa da proxy, conta como viva
 *   morta       — timeout ou resposta vazia em todas as tentativas
 */
export const TESTE_URL = "http://www.gstatic.com/generate_204";
export const TESTE_FALLBACK_URL = "https://www.instagram.com/robots.txt";
export const TESTE_TIMEOUT_MS = 25_000;
export const TESTE_RETENTATIVAS = 2;
export const TESTE_PAUSA_MS = 5_000;
export const LENTA_MS = 6_000;

/** Motivo legível por estado (sem a credencial). */
export const MOTIVO = {
  credencial: "a proxy recusou o usuário/senha (HTTP 407)",
  recusada: "conexão recusada ou host inexistente (host/porta errados)",
  morta: "a proxy não respondeu",
  limitada: "o site de teste limitou a proxy (HTTP 429), não é culpa dela",
};

/**
 * Classifica UMA tentativa do curl: { codigo (exit do curl), http, connect (CONNECT do https), ms, stderr }.
 * @returns {{ estado: "ok"|"credencial"|"recusada"|"limitada"|"morta"|"outro", detalhe: string }}
 */
export function classificarTentativa({ codigo, http, connect = 0, stderr = "" }) {
  if (http === 407 || connect === 407) return { estado: "credencial", detalhe: "HTTP 407" };
  // SOCKS5 (curl 97 = erro no handshake da proxy): usuário/senha recusados = credencial; o resto, sem resposta útil.
  if (codigo === 97 && /user was rejected|authentication|auth/i.test(String(stderr))) return { estado: "credencial", detalhe: `SOCKS5: ${linha(stderr)}` };
  // Porta HTTP com SOCKS5 escolhido: o curl não reconhece a resposta como SOCKS5.
  if (codigo === 97 && /invalid (version|socks)|not.*socks|unexpected/i.test(String(stderr))) return { estado: "tipo", detalhe: `a porta não fala SOCKS5: ${linha(stderr)}` };
  if (codigo === 97) return { estado: "morta", detalhe: `curl 97: ${linha(stderr)}` };
  if (http === 429) return { estado: "limitada", detalhe: "HTTP 429" };
  if (codigo === 0 && (http === 204 || http === 200)) return { estado: "ok", detalhe: `HTTP ${http}` };
  // curl: 5 = proxy não resolve, 6 = host não resolve, 7 = conexão recusada.
  if (codigo === 5 || codigo === 6 || codigo === 7) return { estado: "recusada", detalhe: `curl ${codigo}: ${linha(stderr)}` };
  // 28 = timeout, 52 = resposta vazia, 56 = conexão caiu: proxy sem resposta.
  if (codigo === 28 || codigo === 52 || codigo === 56) return { estado: "morta", detalhe: `curl ${codigo}: ${linha(stderr)}` };
  return { estado: "outro", detalhe: codigo !== 0 ? `curl ${codigo}: ${linha(stderr)}` : `HTTP ${http || 0}` };
}

function linha(s) {
  return String(s ?? "").trim().split("\n").pop()?.replace(/\/\/[^/@\s]+@/g, "//***@").slice(0, 160) ?? "";
}

/** Uma requisição pela proxy (curl -x), medindo o tempo. */
async function curlPelaProxy(proxy, url, timeoutMs, executar) {
  const inicio = Date.now();
  const r = await executar(
    "curl",
    ["-sS", "-o", "/dev/null", "-m", String(Math.ceil(timeoutMs / 1000)), "-x", proxy, "-w", "%{http_code} %{http_connect}", url],
    { timeoutMs: timeoutMs + 5000 }
  );
  const [http, connect] = String(r.stdout ?? "").trim().split(/\s+/).map(Number);
  return { codigo: r.estourou ? 28 : r.codigo, http: http || 0, connect: connect || 0, ms: Date.now() - inicio, stderr: r.stderr ?? "" };
}

/**
 * Testa a proxy. Devolve { estado: viva|lenta|limitada|credencial|recusada|morta, motivo, ms, tentativas }.
 * @param {string} proxy URL http://usuario:senha@host:porta
 * @param {{ log?: (m: string) => void, executar?: typeof rodar, pausa?: (ms: number) => Promise<void>, timeoutMs?: number, retentativas?: number, pausaMs?: number }} [opts]
 */
export async function testarProxy(proxy, { log = () => {}, executar = rodar, pausa = esperar, timeoutMs = TESTE_TIMEOUT_MS, retentativas = TESTE_RETENTATIVAS, pausaMs = TESTE_PAUSA_MS } = {}) {
  let ultimo = { estado: "morta", detalhe: "sem resposta" };
  const total = retentativas + 1;
  for (let tentativa = 1; tentativa <= total; tentativa++) {
    let r = await curlPelaProxy(proxy, TESTE_URL, timeoutMs, executar);
    let c = classificarTentativa(r);
    // generate_204 respondeu outra coisa (bloqueio do domínio, página de erro da proxy): confere no fallback.
    if (c.estado === "outro") {
      r = await curlPelaProxy(proxy, TESTE_FALLBACK_URL, timeoutMs, executar);
      c = classificarTentativa(r);
    }
    if (c.estado === "ok") {
      const estado = r.ms > LENTA_MS ? "lenta" : "viva";
      return { estado, motivo: estado === "lenta" ? `respondeu em ${(r.ms / 1000).toFixed(1)} s (lenta, acima de ${LENTA_MS / 1000} s)` : `respondeu em ${(r.ms / 1000).toFixed(1)} s`, ms: r.ms, tentativas: tentativa };
    }
    if (c.estado === "limitada") return { estado: "limitada", motivo: MOTIVO.limitada, ms: r.ms, tentativas: tentativa };
    // 407 é definitivo: repetir não muda a senha. Protocolo errado também.
    if (c.estado === "credencial") return { estado: "credencial", motivo: MOTIVO.credencial, ms: r.ms, tentativas: tentativa };
    if (c.estado === "tipo") return { estado: "tipo-errado", motivo: "a porta não fala SOCKS5 (troque o tipo da proxy para HTTP ou use a porta SOCKS5)", ms: r.ms, tentativas: tentativa };
    ultimo = c;
    if (tentativa < total) {
      log(`proxy: tentativa ${tentativa}/${total} falhou (${c.detalhe}), de novo em ${pausaMs / 1000} s`);
      await pausa(pausaMs);
    }
  }
  const estado = ultimo.estado === "recusada" ? "recusada" : "morta";
  return { estado, motivo: `${MOTIVO[estado]} em ${total} tentativas (${ultimo.detalhe})`, ms: null, tentativas: total };
}

/** Estados que deixam a conta seguir. */
export function proxyUsavel(estado) {
  return estado === "viva" || estado === "lenta" || estado === "limitada";
}
