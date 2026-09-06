/**
 * safe-media-fetch.ts — busca de mídia remota com allowlist reavaliada a cada
 * redirect (proteção SSRF).
 *
 * As rotas de proxy (`/api/proxy-download`, `/api/proxy-image`) recebem a URL do
 * cliente e validam o hostname contra uma allowlist. Só que `fetch` segue
 * redirects sozinho e NÃO revalida o destino: uma URL de um domínio permitido
 * que responda 302 para `http://169.254.169.254/...` ou para um endereço de rede
 * interna era seguida sem nenhuma checagem.
 *
 * Aqui os redirects são seguidos manualmente, com a allowlist aplicada em cada
 * salto e um teto de saltos.
 */

const MAX_REDIRECTS = 4;

/** Hostname bate exatamente ou é subdomínio de algum item da allowlist. */
export function isAllowedHost(rawUrl: string, allowedHosts: readonly string[]): boolean {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return false;
  }

  // Só HTTP(S): bloqueia file:, ftp:, data:, gopher: etc.
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return false;

  const hostname = parsed.hostname.toLowerCase();

  // Endereços locais/de metadata nunca são permitidos, mesmo que alguém
  // consiga apontar um domínio da allowlist para eles.
  if (isPrivateHostname(hostname)) return false;

  return allowedHosts.some((h) => hostname === h || hostname.endsWith(`.${h}`));
}

function isPrivateHostname(hostname: string): boolean {
  if (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".internal") ||
    hostname.endsWith(".local")
  ) {
    return true;
  }

  // IPv6 literal (vem entre colchetes já removidos pelo URL parser)
  if (hostname === "::1" || hostname.startsWith("fc") || hostname.startsWith("fd")) return true;

  const v4 = hostname.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!v4) return false;
  const [a, b] = [Number(v4[1]), Number(v4[2])];
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 169 && b === 254) ||          // link-local / metadata de cloud
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127)   // CGNAT
  );
}

/**
 * `fetch` que segue redirects manualmente revalidando a allowlist a cada salto.
 * Lança se um destino intermediário não for permitido.
 */
export async function fetchAllowlisted(
  url: string,
  allowedHosts: readonly string[],
  init: RequestInit = {}
): Promise<Response> {
  let current = url;

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    if (!isAllowedHost(current, allowedHosts)) {
      throw new Error(`Destino não permitido após redirect: ${safeHost(current)}`);
    }

    const res = await fetch(current, { ...init, redirect: "manual" });

    if (res.status < 300 || res.status > 399) return res;

    const location = res.headers.get("location");
    if (!location) return res;

    current = new URL(location, current).toString();
  }

  throw new Error("Excesso de redirects ao buscar a mídia.");
}

function safeHost(raw: string): string {
  try {
    return new URL(raw).hostname;
  } catch {
    return "desconhecido";
  }
}
