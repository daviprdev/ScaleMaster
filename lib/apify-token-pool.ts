import { ApifyClient } from "apify-client";

export const APIFY_RATE_LIMIT_MESSAGE =
  "Nosso sistema de buscas está sobrecarregado no momento. Aguarde 5 minutos e tente novamente.";

/** Parse, dedup e embaralha os tokens a cada execução (random selection). */
export function resolveApifyTokens(): string[] {
  const raw = [
    ...(process.env.APIFY_API_TOKENS?.split(",") ?? []),
    ...(process.env.APIFY_API_TOKEN?.split(",") ?? []),
  ]
    .map((t) => t.trim())
    .filter(Boolean);

  const unique = [...new Set(raw)];

  // Fisher-Yates shuffle — seleciona token diferente a cada chamada
  for (let i = unique.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [unique[i], unique[j]] = [unique[j], unique[i]];
  }

  return unique;
}

/** Detecta erros que indicam token inválido, esgotado ou rate-limited. */
export function isApifyTokenError(msg: string): boolean {
  const m = msg.toLowerCase();
  return (
    m.includes("limit exceeded") ||
    m.includes("usage") ||
    m.includes("quota") ||
    m.includes("rate limit") ||
    m.includes("429") ||
    m.includes("401") ||
    m.includes("403") ||
    m.includes("unauthorized") ||
    m.includes("authentication") ||
    m.includes("forbidden") ||
    m.includes("not found or authentication")
  );
}

/**
 * Executa `fn` com um ApifyClient válido, fazendo failover automático entre
 * todos os tokens disponíveis.
 *
 * - Tokens auth/quota → [APIFY] Token X falhou, tentando o próximo...
 * - Outros erros → lançados imediatamente (não são falha de token)
 * - Todos esgotados → lança erro para o caller tratar como 429
 */
export async function withApifyTokenPool<T>(
  fn: (client: ApifyClient) => Promise<T>
): Promise<T> {
  const tokens = resolveApifyTokens();

  if (tokens.length === 0) {
    throw new Error(
      "NO_TOKENS: APIFY_API_TOKEN não configurado. Adicione a variável de ambiente e faça um novo deploy."
    );
  }

  let lastError = "Erro desconhecido";

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    const label = `...${token.slice(-6)}`;

    try {
      const client = new ApifyClient({ token });
      return await fn(client);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);

      if (isApifyTokenError(msg)) {
        console.warn(
          `[APIFY] Token ${i + 1}/${tokens.length} (${label}) falhou, tentando o próximo... — ${msg}`
        );
        lastError = msg;
        continue;
      }

      // Erro de negócio (perfil privado, sem reels, etc.) — não é problema de token
      throw err;
    }
  }

  throw new Error(`ALL_TOKENS_FAILED: ${lastError}`);
}
