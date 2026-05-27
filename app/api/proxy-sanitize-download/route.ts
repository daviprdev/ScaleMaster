import { NextRequest, NextResponse } from "next/server";
import { sanitizeDoublePass } from "@/utils/videoSanitizer";
import * as fs from "fs";

export const runtime = "nodejs";
export const maxDuration = 300;

// Same allowlist as proxy-download — only CDN domains used by Apify/Instagram.
const ALLOWED_HOSTS = [
  "apifyusercontent.com",
  "apify.com",
  "cdninstagram.com",
  "fbcdn.net",
  "instagram.com",
  "lookaside.fbsbx.com",
  "lookaside.instagram.com",
  "storage.googleapis.com",
  "supabase.co",
  "example.com",
];

function isAllowed(raw: string): boolean {
  try {
    const { hostname } = new URL(raw);
    return ALLOWED_HOSTS.some((h) => hostname === h || hostname.endsWith(`.${h}`));
  } catch {
    return false;
  }
}

// GET /api/proxy-sanitize-download?url=<encoded>&filename=<name>
//
// Full pipeline (Instagram/Apify CDN URLs):
//   1. Download video to /tmp
//   2. FFmpeg — strip metadata + stream copy (pure extraction)
//   3. Send sanitized file to browser as attachment
//   4. Clean up /tmp files
//
// Supabase Storage URLs shortcut:
//   Videos already in the library were sanitized once at save-to-library time.
//   Redirect 307 directly to Supabase CDN — zero bytes through Vercel.
//
// The HEAD endpoint is intentionally omitted — use /api/proxy-download HEAD for
// fast URL validation (no FFmpeg overhead).
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
    console.warn(`[proxy-sanitize] blocked URL — domain not in allowlist: ${url.slice(0, 80)}`);
    return new NextResponse(
      JSON.stringify({ error: `URL domain not allowed: ${new URL(url).hostname}` }),
      { status: 403, headers: { "Content-Type": "application/json" } }
    );
  }

  // Supabase Storage URLs are already sanitized (FFmpeg ran at save-to-library time).
  // Redirect the browser directly to the CDN — no bytes flow through Vercel.
  try {
    const { hostname } = new URL(url);
    if (hostname.endsWith(".supabase.co")) {
      console.log(`[proxy-sanitize] supabase url — redirecting directly, no proxy: ${url.slice(0, 100)}`);
      return NextResponse.redirect(url, 307);
    }
  } catch { /* invalid URL handled below */ }

  console.log(`[proxy-sanitize] starting FFmpeg pass for: ${url.slice(0, 100)}…`);

  const baseName = filename.replace(/\.mp4$/i, "");
  let result: Awaited<ReturnType<typeof sanitizeDoublePass>> | null = null;

  try {
    result = await sanitizeDoublePass(url, baseName);

    const fileBuffer = fs.readFileSync(result.outputPath);
    const safe = filename.replace(/[^a-z0-9_.@()-]/gi, "_").slice(0, 120);
    const mb = (fileBuffer.byteLength / 1_048_576).toFixed(1);

    // Log size to monitor Fast Origin Transfer consumption per download
    console.log(`[proxy-sanitize] done — ${mb} MB (${fileBuffer.byteLength} bytes) → ${safe}`);

    return new NextResponse(fileBuffer, {
      headers: {
        "Content-Type": "video/mp4",
        "Content-Disposition": `attachment; filename="${safe}"`,
        "Content-Length": String(fileBuffer.byteLength),
        "Cache-Control": "no-store",
        "Access-Control-Allow-Origin": "*",
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[proxy-sanitize] error:", msg);
    return new NextResponse(
      JSON.stringify({ error: `Sanitization failed: ${msg}` }),
      { status: 502, headers: { "Content-Type": "application/json" } }
    );
  } finally {
    result?.cleanup();
  }
}
