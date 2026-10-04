/**
 * Client-safe canonical app URL helper.
 * Reads NEXT_PUBLIC_APP_URL without throwing — safe for client components.
 * Falls back to window.location.origin when available, then to empty string.
 */
export function getAppUrlClient(): string {
 const envUrl = process.env.NEXT_PUBLIC_APP_URL?.trim().replace(/\/+$/, "");
 if (envUrl) return envUrl;
 if (typeof window !== "undefined" && window.location?.origin) {
 return window.location.origin.replace(/\/+$/, "");
 }
 return "";
}

/** Instagram OAuth redirect URI for client components. */
export function getInstagramRedirectUriClient(): string {
 const base = getAppUrlClient();
 return base ? `${base}/api/instagram/callback` : "";
}