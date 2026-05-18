const GRAPH_API = "https://graph.facebook.com/v19.0";

export interface TokenRefreshResult {
  token: string;
  expiresAt: Date;
}

/**
 * Troca um Long-Lived Token Meta por um novo via fb_exchange_token.
 * Tokens Meta expiram em ~60 dias; renovar antes de expirar evita
 * interrupção nas publicações.
 */
export async function refreshMetaToken(currentToken: string): Promise<TokenRefreshResult> {
  const params = new URLSearchParams({
    grant_type: "fb_exchange_token",
    client_id: process.env.NEXT_PUBLIC_META_CLIENT_ID!,
    client_secret: process.env.META_CLIENT_SECRET!,
    fb_exchange_token: currentToken,
  });
  const res = await fetch(`${GRAPH_API}/oauth/access_token?${params}`);
  const data = (await res.json()) as {
    access_token?: string;
    expires_in?: number;
    error?: { message: string };
  };
  if (!res.ok || !data.access_token) {
    throw new Error(data.error?.message ?? "Falha ao renovar token Meta.");
  }
  const expiresIn = data.expires_in ?? 5_184_000; // 60 dias como fallback
  return {
    token: data.access_token,
    expiresAt: new Date(Date.now() + expiresIn * 1_000),
  };
}

/**
 * Retorna true se o token expira dentro de `thresholdDays` dias ou já expirou.
 */
export function isTokenExpiringSoon(
  tokenExpiresAt: string | null | undefined,
  thresholdDays = 7
): boolean {
  if (!tokenExpiresAt) return false;
  const threshold = Date.now() + thresholdDays * 24 * 60 * 60 * 1_000;
  return new Date(tokenExpiresAt).getTime() <= threshold;
}
