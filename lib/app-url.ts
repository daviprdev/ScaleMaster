/**
 * Canonical app URL for server-side code.
 * NEVER falls back to a hardcoded URL.
 * Throws in production RUNTIME if NEXT_PUBLIC_APP_URL is missing.
 * During build (NEXT_PHASE === 'phase-production-build'), returns a safe
 * placeholder so static generation does not fail — the real value is only
 * needed when the route actually executes at runtime.
 */
export function getAppUrl(): string {
  const url = process.env.NEXT_PUBLIC_APP_URL?.trim().replace(/\/+$/, "");
  if (!url) {
    // During Next.js build, env vars may not be loaded yet. Return a
    // placeholder that will be replaced at runtime when the request hits.
    if (process.env.NEXT_PHASE === "phase-production-build") {
      return "__APP_URL_NOT_SET__";
    }
    if (process.env.NODE_ENV === "production") {
      throw new Error(
        "NEXT_PUBLIC_APP_URL is required in production. " +
          "Set it to the canonical public URL (e.g. https://scalemaster.tech)."
      );
    }
    return "http://localhost:3000";
  }
  return url;
}

/** Instagram OAuth redirect URI derived from the canonical app URL. */
export function getInstagramRedirectUri(): string {
  return `${getAppUrl()}/api/instagram/callback`;
}