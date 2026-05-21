import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

// Allowlist prevents use as a generic SSRF proxy — only CDN domains used by
// Apify and Instagram are permitted.
const ALLOWED_HOSTS = [
  // Apify user-content CDN (primary source for scraped reels)
  "apifyusercontent.com",
  "apify.com",
  // Instagram / Facebook CDNs — many subdomain variants
  "cdninstagram.com",
  "fbcdn.net",
  "instagram.com",
  "lookaside.fbsbx.com",
  "lookaside.instagram.com",
  // Google Cloud Storage (some Apify actors stage files here)
  "storage.googleapis.com",
  // Supabase Storage (reels already uploaded)
  "supabase.co",
  // Allowed in development/mock mode so that mock URLs don't crash silently
  "example.com",
];

function isAllowed(raw: string): boolean {
  try {
    const { hostname } = new URL(raw);
    return ALLOWED_HOSTS.some(h => hostname === h || hostname.endsWith(`.${h}`));
  } catch {
    return false;
  }
}

// Headers that best mimic a real browser loading a video element
const VIDEO_FETCH_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  Referer: "https://www.instagram.com/",
  Origin: "https://www.instagram.com",
  Accept: "video/mp4,video/webm,video/ogg,*/*;q=0.8",
  "Accept-Language": "pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7",
  "sec-fetch-dest": "video",
  "sec-fetch-mode": "cors",
  "sec-fetch-site": "cross-site",
  "Cache-Control": "no-cache",
};

// GET /api/proxy-download?url=<encoded-video-url>&filename=<filename>
//
// 1. Validates the URL against the allowlist (SSRF protection).
// 2. Fetches the video server-side — bypasses browser CORS restrictions and
//    CDN Referer checks that would block a direct client-side fetch.
// 3. Streams the response body back with Content-Disposition: attachment so
//    the browser triggers a save-as dialog.
//
// Response body is streamed (not buffered) so large files don't exhaust
// serverless memory.
export async function GET(req: NextRequest) {
  const url = req.nextUrl.searchParams.get("url");
  const filename = req.nextUrl.searchParams.get("filename") ?? "autoscale_reel.mp4";

  if (!url || url.trim() === "") {
    return new NextResponse(
      JSON.stringify({ error: "Missing or empty url param" }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  if (!isAllowed(url)) {
    console.warn(`[proxy-download] blocked URL — domain not in allowlist: ${url.slice(0, 80)}`);
    return new NextResponse(
      JSON.stringify({ error: `URL domain not allowed: ${new URL(url).hostname}` }),
      { status: 403, headers: { "Content-Type": "application/json" } }
    );
  }

  console.log(`[proxy-download] fetching: ${url.slice(0, 100)}…`);

  try {
    const upstream = await fetch(url, {
      headers: VIDEO_FETCH_HEADERS,
      signal: AbortSignal.timeout(60_000), // 60 s — large reels can be slow
    });

    if (!upstream.ok) {
      const reason = `Upstream CDN returned ${upstream.status} for ${new URL(url).hostname}`;
      console.error(`[proxy-download] ${reason}`);
      return new NextResponse(
        JSON.stringify({ error: reason }),
        { status: 502, headers: { "Content-Type": "application/json" } }
      );
    }

    const safe = filename.replace(/[^a-z0-9_.@()-]/gi, "_").slice(0, 120);
    const contentType = upstream.headers.get("content-type") ?? "video/mp4";
    const contentLength = upstream.headers.get("content-length");

    const headers: Record<string, string> = {
      "Content-Type": contentType,
      // Forces browser save-as dialog with the given filename
      "Content-Disposition": `attachment; filename="${safe}"`,
      "Cache-Control": "no-store",
      "Access-Control-Allow-Origin": "*",
    };
    if (contentLength) headers["Content-Length"] = contentLength;

    console.log(`[proxy-download] streaming ${contentLength ?? "unknown size"} bytes → ${safe}`);

    // Stream directly — avoids loading the full video into serverless memory
    return new NextResponse(upstream.body, { headers });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[proxy-download] fetch error:", msg);
    return new NextResponse(
      JSON.stringify({ error: `Proxy fetch failed: ${msg}` }),
      { status: 502, headers: { "Content-Type": "application/json" } }
    );
  }
}

// HEAD is identical to GET but without a body — used by the client to check
// whether a URL is accessible before attempting the full download.
export async function HEAD(req: NextRequest) {
  const url = req.nextUrl.searchParams.get("url");

  if (!url || !isAllowed(url)) {
    return new NextResponse(null, { status: url ? 403 : 400 });
  }

  try {
    const upstream = await fetch(url, {
      method: "HEAD",
      headers: VIDEO_FETCH_HEADERS,
      signal: AbortSignal.timeout(10_000),
    });
    return new NextResponse(null, { status: upstream.ok ? 200 : 502 });
  } catch {
    return new NextResponse(null, { status: 502 });
  }
}
