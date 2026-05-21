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
// Full pipeline:
//   1. Download video to /tmp
//   2. FFmpeg Pass 1 — strip all original metadata (-map_metadata -1, stream copy)
//   3. FFmpeg Pass 2 — inject UUID comment + bitexact flags (no encoder fingerprint)
//   4. Send sanitized file to browser as attachment
//   5. Clean up /tmp files
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

  console.log(`[proxy-sanitize] starting double-pass for: ${url.slice(0, 100)}…`);

  const baseName = filename.replace(/\.mp4$/i, "");
  let result: Awaited<ReturnType<typeof sanitizeDoublePass>> | null = null;

  try {
    result = await sanitizeDoublePass(url, baseName);

    const fileBuffer = fs.readFileSync(result.outputPath);
    const safe = filename.replace(/[^a-z0-9_.@()-]/gi, "_").slice(0, 120);

    console.log(`[proxy-sanitize] done — ${fileBuffer.byteLength} bytes → ${safe}`);

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
