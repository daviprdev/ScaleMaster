import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

// Allowlist prevents use as a generic SSRF proxy — only CDN domains used by
// Apify scrapers and Instagram are permitted.
const ALLOWED_HOSTS = [
  // Apify user-content CDN (primary source for scraped reels)
  "apifyusercontent.com",
  "apify.com",
  // Instagram / Facebook CDNs
  "cdninstagram.com",
  "fbcdn.net",
  "instagram.com",
  "lookaside.fbsbx.com",
  // Google Cloud Storage (some Apify actors stage files here)
  "storage.googleapis.com",
  // Supabase Storage (reels already uploaded)
  "supabase.co",
];

function isAllowed(raw: string): boolean {
  try {
    const { hostname } = new URL(raw);
    return ALLOWED_HOSTS.some(h => hostname === h || hostname.endsWith(`.${h}`));
  } catch {
    return false;
  }
}

// GET /api/proxy-download?url=<encoded-video-url>&filename=<filename>
//
// Fetches the video server-side — bypassing browser CORS restrictions and
// CDN Referer checks — then streams the bytes back with a
// Content-Disposition: attachment header so the browser saves it as a file.
//
// The response body is streamed (not buffered) so large files don't exhaust
// serverless memory and aren't capped by Vercel's response body limit.
export async function GET(req: NextRequest) {
  const url = req.nextUrl.searchParams.get("url");
  const filename = req.nextUrl.searchParams.get("filename") ?? "autoscale_reel.mp4";

  if (!url) return new NextResponse("Missing url param", { status: 400 });
  if (!isAllowed(url)) return new NextResponse("URL not allowed", { status: 403 });

  try {
    const upstream = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        Referer: "https://www.instagram.com/",
        Accept: "video/mp4,video/*;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
      },
    });

    if (!upstream.ok) {
      return new NextResponse(`Upstream ${upstream.status}`, { status: 502 });
    }

    const safe = filename.replace(/[^a-z0-9_.@-]/gi, "_").slice(0, 120);
    const contentType = upstream.headers.get("content-type") ?? "video/mp4";
    const contentLength = upstream.headers.get("content-length");

    const headers: Record<string, string> = {
      "Content-Type": contentType,
      // Forces browser save-as dialog with a clean filename
      "Content-Disposition": `attachment; filename="${safe}"`,
      "Cache-Control": "no-store",
      "Access-Control-Allow-Origin": "*",
    };
    if (contentLength) headers["Content-Length"] = contentLength;

    // Stream the response body directly — avoids buffering the full video in
    // serverless memory and bypasses potential response-size limits.
    return new NextResponse(upstream.body, { headers });
  } catch (err) {
    console.error("[proxy-download] error:", err);
    return new NextResponse("Download failed", { status: 502 });
  }
}
