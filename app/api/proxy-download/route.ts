import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

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

// Headers that mimic an iPhone Safari client — Instagram CDN is less likely to
// 403 mobile requests than datacenter desktop UAs on Vercel egress IPs.
const VIDEO_FETCH_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (iPhone; CPU iPhone OS 16_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.5 Mobile/15E148 Safari/604.1",
  Referer: "https://www.instagram.com/",
  Origin: "https://www.instagram.com",
  Accept: "video/mp4,video/webm,video/ogg,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
  "sec-fetch-dest": "video",
  "sec-fetch-mode": "no-cors",
  "sec-fetch-site": "cross-site",
  "Cache-Control": "no-cache",
  Connection: "keep-alive",
};

// GET /api/proxy-download?url=<encoded-video-url>&filename=<filename>
//
// 1. Validates the URL against the allowlist (SSRF protection).
// 2. Supabase Storage URLs: redirect 307 directly — video is served by Supabase CDN,
//    zero bytes flow through Vercel.
// 3. Other CDN URLs: fetches server-side (bypasses CORS + Referer restrictions) and
//    streams the body. Response is streamed (not buffered) to avoid OOM on large files.
//
export async function GET(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return new NextResponse(
      JSON.stringify({ error: "Não autenticado." }),
      { status: 401, headers: { "Content-Type": "application/json" } }
    );
  }

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

  // Supabase Storage URLs — already on the Supabase CDN, publicly accessible.
  // Redirect the browser directly: zero bytes flow through Vercel.
  try {
    const { hostname } = new URL(url);
    if (hostname.endsWith(".supabase.co")) {
      console.log(`[proxy-download] supabase url — redirecting directly: ${url.slice(0, 100)}`);
      return NextResponse.redirect(url, 307);
    }
  } catch { /* invalid URL will fail below */ }

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

// HEAD is used by the client for fast URL validation before triggering a full download.
// Supabase URLs are always reachable — return 200 without a network fetch.
export async function HEAD(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return new NextResponse(null, { status: 401 });
  }

  const url = req.nextUrl.searchParams.get("url");

  if (!url || !isAllowed(url)) {
    return new NextResponse(null, { status: url ? 403 : 400 });
  }

  try {
    const { hostname } = new URL(url);
    if (hostname.endsWith(".supabase.co")) {
      return new NextResponse(null, { status: 200 });
    }
  } catch {
    return new NextResponse(null, { status: 400 });
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
