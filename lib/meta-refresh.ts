// Renovação de token é chamada oficial da Meta: conexão direta, sem proxy.
import { fetch as undiciFetch } from "undici";

const GRAPH_FB = "https://graph.facebook.com/v19.0";
const GRAPH_IG = "https://graph.instagram.com";

export interface TokenRefreshResult {
  token: string;
  expiresAt: Date;
}

/**
 * Renova um Long-Lived Token Meta, escolhendo o endpoint correto pelo tipo de conexão.
 *
 * - Instagram Login (fbPageId ausente/nulo):
 *     GET graph.instagram.com/refresh_access_token?grant_type=ig_refresh_token
 *     Não exige client_id nem client_secret.
 *
 * - Facebook Login (fbPageId preenchido):
 *     GET graph.facebook.com/oauth/access_token?grant_type=fb_exchange_token
 *     Exige client_id e client_secret.
 */
export async function refreshMetaToken(
  currentToken: string,
  fbPageId?: string | null,
  appCredentials?: { clientId: string; clientSecret: string } | null
): Promise<TokenRefreshResult> {
  return fbPageId
    ? refreshFacebookToken(currentToken, appCredentials)
    : refreshInstagramToken(currentToken);
}

async function refreshInstagramToken(
  currentToken: string
): Promise<TokenRefreshResult> {
  const params = new URLSearchParams({
    grant_type: "ig_refresh_token",
    access_token: currentToken,
  });
  const res = await undiciFetch(
    `${GRAPH_IG}/refresh_access_token?${params}`,
    { signal: AbortSignal.timeout(45_000) }
  );
  const data = (await res.json()) as {
    access_token?: string;
    expires_in?: number;
    error?: { message: string };
  };
  if (!res.ok || !data.access_token) {
    throw new Error(data.error?.message ?? "Falha ao renovar token Instagram Login.");
  }
  const expiresIn = data.expires_in ?? 5_184_000;
  return {
    token: data.access_token,
    expiresAt: new Date(Date.now() + expiresIn * 1_000),
  };
}

async function refreshFacebookToken(
  currentToken: string,
  appCredentials?: { clientId: string; clientSecret: string } | null
): Promise<TokenRefreshResult> {
  const clientId = appCredentials?.clientId ?? process.env.NEXT_PUBLIC_META_CLIENT_ID!;
  const clientSecret = appCredentials?.clientSecret ?? process.env.META_CLIENT_SECRET!;
  const params = new URLSearchParams({
    grant_type: "fb_exchange_token",
    client_id: clientId,
    client_secret: clientSecret,
    fb_exchange_token: currentToken,
  });
  const res = await undiciFetch(
    `${GRAPH_FB}/oauth/access_token?${params}`,
    { signal: AbortSignal.timeout(45_000) }
  );
  const data = (await res.json()) as {
    access_token?: string;
    expires_in?: number;
    error?: { message: string };
  };
  if (!res.ok || !data.access_token) {
    throw new Error(data.error?.message ?? "Falha ao renovar token Facebook Login.");
  }
  const expiresIn = data.expires_in ?? 5_184_000;
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
