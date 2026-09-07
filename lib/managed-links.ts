/**
 * managed-links.ts — as definições canônicas dos Links Gerenciáveis.
 *
 * Toda validação de slug e de destino mora aqui, e tanto as rotas privadas
 * (`/api/links/*`) quanto a rota pública (`/r/[slug]`) usam estas funções. Nada
 * de validar URL de destino em dois lugares com regras diferentes.
 *
 * REGRA PERMANENTE — SEM CLOAKING: nada neste arquivo decide destino. Não há
 * ramificação por User-Agent, referrer, país ou "parece crawler". O
 * User-Agent é lido apenas para reduzi-lo a uma categoria de analytics, e o
 * resultado dessa leitura NUNCA volta para o cálculo da URL final.
 */

import { randomBytes } from "node:crypto";

// ── Slug ────────────────────────────────────────────────────────────────────

/** base62. Slug automático é case-sensitive de propósito: forçar minúsculas
 *  jogaria fora metade da entropia (62^7 ≈ 3,5e12 → 36^7 ≈ 7,8e10). */
const SLUG_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
export const SLUG_MIN = 3;
export const SLUG_MAX = 50;
export const AUTO_SLUG_LENGTH = 7;

/**
 * Caminhos que não podem virar slug. Alguns porque conflitariam com rotas
 * reais do app se o subdomínio de redirect um dia servir mais que `/r/*`;
 * outros porque um link `/r/login` ou `/r/admin` é isca óbvia de phishing.
 */
export const RESERVED_SLUGS: ReadonlySet<string> = new Set([
  "admin", "api", "dashboard", "login", "logout", "auth", "register", "signup",
  "settings", "account", "accounts", "favicon", "robots", "sitemap", "health",
  "status", "static", "public", "assets", "_next", "r", "link", "links",
  "new", "edit", "delete", "null", "undefined", "app", "www", "support",
  "help", "terms", "privacy", "security", "billing", "checkout", "pay",
]);

/**
 * Slug aleatório com `crypto.randomBytes` — nunca `Math.random()`.
 *
 * Amostragem por rejeição: 256 não é múltiplo de 62, então bytes ≥ 248 são
 * descartados. Sem isso os 8 primeiros caracteres do alfabeto sairiam com
 * probabilidade maior que os demais (viés de módulo).
 */
export function generateSlug(length: number = AUTO_SLUG_LENGTH): string {
  const limit = 256 - (256 % SLUG_ALPHABET.length); // 248
  let out = "";
  while (out.length < length) {
    const buf = randomBytes(length * 2);
    for (let i = 0; i < buf.length && out.length < length; i++) {
      const b = buf[i];
      if (b >= limit) continue;
      out += SLUG_ALPHABET[b % SLUG_ALPHABET.length];
    }
  }
  return out;
}

export type SlugCheck = { ok: true; slug: string } | { ok: false; error: string };

/**
 * Slug customizado. Normalizado para minúsculas — o automático é misto, mas
 * um slug digitado por pessoa precisa ser previsível: quem divulga
 * `/r/Oferta` e digita `/r/oferta` tem que cair no mesmo lugar. A busca no
 * banco é case-sensitive, então normalizar na entrada é o que torna a
 * política consistente.
 */
export function normalizeCustomSlug(raw: string): SlugCheck {
  const slug = (raw ?? "").trim().toLowerCase();

  if (slug.length < SLUG_MIN)
    return { ok: false, error: `O slug precisa de pelo menos ${SLUG_MIN} caracteres.` };
  if (slug.length > SLUG_MAX)
    return { ok: false, error: `O slug pode ter no máximo ${SLUG_MAX} caracteres.` };
  if (!/^[a-z0-9_-]+$/.test(slug))
    return { ok: false, error: "Use apenas letras, números, hífen e underscore." };
  if (RESERVED_SLUGS.has(slug))
    return { ok: false, error: `"${slug}" é uma palavra reservada. Escolha outro slug.` };

  return { ok: true, slug };
}

/** Aceita o formato de qualquer slug (automático ou custom) na rota pública. */
export function isWellFormedSlug(slug: string): boolean {
  return typeof slug === "string" &&
    slug.length >= SLUG_MIN && slug.length <= SLUG_MAX &&
    /^[A-Za-z0-9_-]+$/.test(slug);
}

// ── Destino ─────────────────────────────────────────────────────────────────

export const DESTINATION_MAX_LENGTH = 2048;

export type DestinationCheck =
  | { ok: true; url: string }
  | { ok: false; error: string };

/**
 * O servidor NUNCA busca o destino (sem fetch, sem HEAD). Então isto não é um
 * scanner de SSRF — é o mínimo para que a rota de redirect jamais produza uma
 * URL perigosa ou aponte para dentro da infraestrutura.
 *
 * Bloqueia: qualquer scheme fora de http/https (javascript:, data:, file:,
 * ftp:, chrome:, about:, ...), credenciais embutidas (`user:senha@host`),
 * localhost/loopback e faixas privadas/metadata de nuvem.
 */
export function validateDestinationUrl(raw: string): DestinationCheck {
  const input = (raw ?? "").trim();

  if (!input) return { ok: false, error: "Informe a URL de destino." };
  if (input.length > DESTINATION_MAX_LENGTH)
    return { ok: false, error: `A URL de destino passa de ${DESTINATION_MAX_LENGTH} caracteres.` };

  // Caracteres de controle quebrariam o header Location (CR/LF = header
  // splitting). O parser WHATWG remove tab/CR/LF em silêncio, então a checagem
  // tem de vir ANTES do new URL().
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001F\u007F]/.test(input))
    return { ok: false, error: "A URL contém caracteres inválidos." };

  let parsed: URL;
  try {
    parsed = new URL(input);
  } catch {
    return { ok: false, error: "URL inválida. Comece com https:// ou http://" };
  }

  if (parsed.protocol !== "https:" && parsed.protocol !== "http:")
    return { ok: false, error: "Somente https:// e http:// são aceitos." };

  if (parsed.username || parsed.password)
    return { ok: false, error: "URLs com usuário:senha embutidos não são aceitas." };

  if (!parsed.hostname)
    return { ok: false, error: "URL sem domínio." };

  if (isPrivateHostname(parsed.hostname.toLowerCase()))
    return { ok: false, error: "Endereços locais ou de rede interna não são aceitos como destino." };

  return { ok: true, url: parsed.toString() };
}

/**
 * Cópia deliberada da lógica de `lib/safe-media-fetch.ts`: lá ela protege um
 * fetch com allowlist; aqui protege um header Location, sem allowlist alguma
 * (o destino é a internet inteira, menos rede interna). Manter as duas
 * separadas evita que afrouxar uma afrouxe a outra sem querer.
 */
function isPrivateHostname(hostname: string): boolean {
  if (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".internal") ||
    hostname.endsWith(".local") ||
    hostname === "0.0.0.0"
  ) return true;

  if (hostname === "::1" || hostname === "[::1]") return true;

  // ULA IPv6 (fc00::/7). O `:` é obrigatório na checagem: sem ele, qualquer
  // domínio começado em "fc"/"fd" — fcbarcelona.com, fdny.org — seria barrado
  // como se fosse endereço de rede interna.
  if (hostname.includes(":") && /^\[?f[cd][0-9a-f:]*\]?$/.test(hostname)) return true;

  const v4 = hostname.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!v4) return false;
  const a = Number(v4[1]);
  const b = Number(v4[2]);
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 169 && b === 254) ||          // link-local / metadata de nuvem
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127)   // CGNAT
  );
}

/** Um id malformado nem chega ao Postgres (que responderia 22P02, virando 500). */
export function isUuid(value: string | null | undefined): boolean {
  return typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

// ── Analytics: redução de dado pessoal ──────────────────────────────────────

export type DeviceType = "desktop" | "mobile" | "tablet" | "other";
export type BrowserFamily = "Chrome" | "Safari" | "Firefox" | "Edge" | "Opera" | "Other";

/**
 * O User-Agent completo NUNCA é gravado — vira uma de quatro categorias.
 * Nenhuma decisão de redirecionamento sai daqui.
 */
export function deviceTypeFromUserAgent(ua: string | null | undefined): DeviceType {
  if (!ua) return "other";
  const s = ua.toLowerCase();
  if (s.includes("ipad") || s.includes("tablet") || s.includes("kindle") ||
      s.includes("silk") || (s.includes("android") && !s.includes("mobile"))) return "tablet";
  if (s.includes("mobi") || s.includes("iphone") || s.includes("ipod") ||
      s.includes("android") || s.includes("windows phone")) return "mobile";
  if (s.includes("windows") || s.includes("macintosh") || s.includes("mac os") ||
      s.includes("x11") || s.includes("linux") || s.includes("cros")) return "desktop";
  return "other";
}

/** Família do navegador. A ordem importa: Edge e Opera também dizem "Chrome". */
export function browserFamilyFromUserAgent(ua: string | null | undefined): BrowserFamily {
  if (!ua) return "Other";
  const s = ua.toLowerCase();
  if (s.includes("edg/") || s.includes("edga/") || s.includes("edgios/")) return "Edge";
  if (s.includes("opr/") || s.includes("opera")) return "Opera";
  if (s.includes("firefox") || s.includes("fxios")) return "Firefox";
  if (s.includes("chrome") || s.includes("crios") || s.includes("chromium")) return "Chrome";
  if (s.includes("safari")) return "Safari";
  return "Other";
}

/**
 * Do Referer sobra só o hostname. A URL completa da página de origem pode
 * carregar token, e-mail ou termo de busca — nada disso tem por que entrar no
 * banco para dizer "veio do Instagram".
 */
export function referrerHost(referer: string | null | undefined): string | null {
  if (!referer) return null;
  try {
    const host = new URL(referer).hostname.toLowerCase();
    return host ? host.slice(0, 253) : null;
  } catch {
    return null;
  }
}

// ── Montagem da URL final ───────────────────────────────────────────────────

/** Teto de parâmetros repassados — impede um Location gigante por abuso. */
const MAX_FORWARDED_PARAMS = 25;

/**
 * Constrói a URL final do redirect.
 *
 * Com `forward = false` (padrão) a query pública é ignorada por completo: o
 * destino sai exatamente como está gravado.
 *
 * Com `forward = true` os parâmetros da URL pública são mesclados via
 * `URLSearchParams` — nunca por concatenação de string.
 *
 * REGRA DE PRECEDÊNCIA: parâmetro que já existe no `destination_url` VENCE. O
 * destino foi configurado pelo dono do link; a query pública vem de quem
 * clicou e é, portanto, controlável por terceiros. Deixar o visitante
 * sobrescrever um parâmetro do destino permitiria adulterar algo como um
 * `?ref=` ou `?plan=` do próprio dono.
 */
export function buildRedirectUrl(
  destination: string,
  incoming: URLSearchParams,
  forward: boolean
): string {
  if (!forward) return destination;

  let target: URL;
  try {
    target = new URL(destination);
  } catch {
    return destination;
  }

  let added = 0;
  for (const [key, value] of incoming.entries()) {
    if (added >= MAX_FORWARDED_PARAMS) break;
    if (!key) continue;
    if (target.searchParams.has(key)) continue;   // o destino tem precedência
    target.searchParams.append(key, value);
    added++;
  }

  const out = target.toString();
  // Se o merge estourar o teto, publica o destino puro em vez de um Location
  // absurdo.
  return out.length <= DESTINATION_MAX_LENGTH * 2 ? out : destination;
}

// ── Domínio público ─────────────────────────────────────────────────────────

/**
 * Base do link público. `NEXT_PUBLIC_REDIRECT_BASE_URL` é a fonte da verdade
 * (ex.: `https://go.exemplo.com`).
 *
 * Sem a env var, cai para a origem atual — o que é correto em
 * desenvolvimento, e em produção mantém o link funcionando pelo domínio do
 * próprio app (é o mesmo deploy que serve `/r/*`). A UI avisa quando está
 * nesse modo, para o usuário não divulgar um link `*.vercel.app` achando que
 * é o domínio definitivo.
 */
export function redirectBaseUrl(fallbackOrigin?: string): string {
  const configured = process.env.NEXT_PUBLIC_REDIRECT_BASE_URL?.trim();
  const base = configured || fallbackOrigin || "";
  return base.replace(/\/+$/, "");
}

/** URL pública completa do link. */
export function publicLinkUrl(slug: string, fallbackOrigin?: string): string {
  return `${redirectBaseUrl(fallbackOrigin)}/r/${slug}`;
}

// ── Limites anti-abuso ──────────────────────────────────────────────────────

/** Teto de links criados por hora, por usuário (checado no banco). */
export const CREATE_RATE_LIMIT_PER_HOUR = 60;
/** Teto total de links por usuário. */
export const MAX_LINKS_PER_USER = 5000;
