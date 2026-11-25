// Instagram Login → token "IG…" em graph.instagram.com.
// Unified Login (Facebook Login for Business) → token "EAA…" (system user) em graph.facebook.com.
export const GRAPH_VERSION = "v21.0";
export const GRAPH_IG_BASE = `https://graph.instagram.com/${GRAPH_VERSION}`;
export const GRAPH_FB_BASE = `https://graph.facebook.com/${GRAPH_VERSION}`;

// Token de system user do Unified Login não vence.
export const UNIFIED_TOKEN_EXPIRES_AT = new Date("2099-12-31T00:00:00Z");

export function isUnifiedToken(token: string | null | undefined): boolean {
  return !!token && token.startsWith("EAA");
}

export function graphBase(token: string | null | undefined): string {
  return isUnifiedToken(token) ? GRAPH_FB_BASE : GRAPH_IG_BASE;
}
