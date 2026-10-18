/**
 * lib/hikerapi-client.ts — Cliente HTTP da HikerAPI (API hospedada dos autores
 * do instagrapi). Fonte principal da aba Inspirações quando HIKERAPI_KEY existe.
 *
 * Docs: https://api.hikerapi.com/docs (spec em /openapi.json)
 *
 * Por que ela: /v1/user/clips/chunk pagina a lista de reels do perfil inteira
 * (medido: @michellearueira → 24 reels, todos os públicos; a ScrapeCreators
 * parava em 14). Cobra por requisição: 1 para achar o perfil + 1 por página
 * de ~12 reels.
 *
 * A chave vive SOMENTE no backend: nunca vai para o navegador, logs ou erros.
 * User-Agent explícito: a Cloudflare da HikerAPI bloqueia o UA padrão de
 * clientes HTTP (erro 1010).
 */

const BASE_URL = "https://api.hikerapi.com";
const USER_AGENT = "scalemaster/1.0";

/** Mídia da HikerAPI (schema Media) — só os campos usados aqui. */
export interface HikerMedia {
  pk: string;
  id?: string;
  code: string;
  taken_at?: string | null;
  media_type?: number;
  product_type?: string | null;
  caption_text?: string | null;
  play_count?: number | null;
  view_count?: number | null;
  like_count?: number | null;
  comment_count?: number | null;
  video_duration?: number | null;
  video_url?: string | null;
  thumbnail_url?: string | null;
  user?: {
    pk?: string;
    username?: string;
    full_name?: string | null;
    profile_pic_url?: string | null;
  } | null;
}

export interface HikerUser {
  pk: string;
  username: string;
  full_name?: string | null;
  profile_pic_url?: string | null;
  is_private?: boolean;
  media_count?: number;
}

/** Erro com o status HTTP da HikerAPI (sem a chave nem o corpo completo). */
export class HikerApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

// ── Pool de tokens (rotação) ──────────────────────────────────────────────────
// Tokens em HIKERAPI_KEYS e/ou HIKERAPI_KEY, separados por vírgula. Cada
// chamada começa pelo próximo token da fila (distribui o consumo entre as
// contas). Token sem saldo (402) ou recusado (401/403) sai da fila por 30 min;
// rate limit (429) descansa 1 min — nos dois casos o próximo é tentado na
// mesma chamada (a HikerAPI não cobra chamada recusada). Estado em memória do
// processo: um restart só faz cada token esgotado ser tentado de novo 1 vez.

const EXHAUSTED_COOLDOWN_MS = 30 * 60_000;
const RATE_LIMIT_COOLDOWN_MS = 60_000;
const cooldownUntil = new Map<string, number>();
let nextTokenIndex = 0;

function hikerTokens(): string[] {
  const raw = [
    ...(process.env.HIKERAPI_KEYS?.split(",") ?? []),
    ...(process.env.HIKERAPI_KEY?.split(",") ?? []),
  ].map((t) => t.trim()).filter(Boolean);
  return [...new Set(raw)];
}

export function hikerConfigured(): boolean {
  return hikerTokens().length > 0;
}

/** Ordem de tentativa desta chamada: rodízio, tokens em descanso por último. */
function tokensForThisCall(): string[] {
  const tokens = hikerTokens();
  if (tokens.length === 0) return [];
  const start = nextTokenIndex % tokens.length;
  nextTokenIndex = (start + 1) % tokens.length;
  const rotated = [...tokens.slice(start), ...tokens.slice(0, start)];
  const now = Date.now();
  const ready = rotated.filter((t) => (cooldownUntil.get(t) ?? 0) <= now);
  // Se todos estão em descanso, tenta mesmo assim (o saldo pode ter sido recarregado).
  return ready.length > 0 ? ready : rotated;
}

async function hikerGet<T>(path: string, params: Record<string, string>): Promise<T> {
  const tokens = tokensForThisCall();
  if (tokens.length === 0) throw new HikerApiError(0, "HIKERAPI_KEY(S) não configurado.");

  let lastTokenError: HikerApiError | null = null;
  for (const key of tokens) {
    const res = await fetch(`${BASE_URL}${path}?${new URLSearchParams(params)}`, {
      method: "GET",
      headers: { "x-access-key": key, accept: "application/json", "user-agent": USER_AGENT },
      signal: AbortSignal.timeout(60_000),
    });

    if (res.ok) {
      cooldownUntil.delete(key);
      return res.json() as Promise<T>;
    }

    // Só o "detail"/"error" curto da HikerAPI (ex.: "Entries not found"), nunca a chave.
    let detail = "";
    try {
      const body = (await res.json()) as { detail?: unknown; error?: unknown };
      const text = typeof body.detail === "string" ? body.detail : typeof body.error === "string" ? body.error : "";
      if (text) detail = ` ${text.slice(0, 120)}`;
    } catch { /* corpo não-JSON (ex.: página da Cloudflare) */ }
    const err = new HikerApiError(res.status, `HikerAPI ${path}: HTTP ${res.status}${detail}`);

    // Problema do TOKEN → descansa e tenta o próximo. Qualquer outro erro
    // (404 perfil inexistente, 5xx…) não é do token: devolve na hora.
    if (res.status === 402 || res.status === 401 || res.status === 403 || res.status === 429) {
      cooldownUntil.set(key, Date.now() + (res.status === 429 ? RATE_LIMIT_COOLDOWN_MS : EXHAUSTED_COOLDOWN_MS));
      console.warn(`[hikerapi] token …${key.slice(-4)} recusado (HTTP ${res.status}) — tentando o próximo.`);
      lastTokenError = err;
      continue;
    }
    throw err;
  }

  // Todos os tokens recusaram: o status do último decide a mensagem (402 = sem saldo).
  throw lastTokenError ?? new HikerApiError(0, "HikerAPI: nenhum token disponível.");
}

/** Perfil pelo @ (1 requisição). */
export function hikerUserByUsername(username: string): Promise<HikerUser> {
  return hikerGet<HikerUser>("/v1/user/by/username", { username });
}

/**
 * Uma página de reels do perfil. `nextCursor` null = fim da lista.
 * A resposta é o par [mídias, cursor].
 */
export async function hikerUserClipsChunk(
  userId: string,
  endCursor?: string | null
): Promise<{ items: HikerMedia[]; nextCursor: string | null }> {
  const params: Record<string, string> = { user_id: userId };
  if (endCursor) params.end_cursor = endCursor;
  const data = await hikerGet<unknown>("/v1/user/clips/chunk", params);
  if (Array.isArray(data) && data.length === 2 && Array.isArray(data[0])) {
    return { items: data[0] as HikerMedia[], nextCursor: (data[1] as string | null) || null };
  }
  throw new HikerApiError(200, "HikerAPI /v1/user/clips/chunk: resposta em formato inesperado");
}

/** Uma mídia pelo shortcode (1 requisição) — usado para renovar URL expirada. */
export function hikerMediaByCode(code: string): Promise<HikerMedia> {
  return hikerGet<HikerMedia>("/v1/media/by/code", { code });
}
