import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Health check endpoint for Docker/VPS deployments.
 * Returns 200 if the server is running and Supabase is configured.
 * Does NOT expose secrets, tokens, or internal state.
 */
export async function GET() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const encryptionSecret = process.env.ENCRYPTION_SECRET;

  if (!supabaseUrl) {
    return NextResponse.json(
      { status: "unhealthy", reason: "NEXT_PUBLIC_SUPABASE_URL not configured" },
      { status: 503 },
    );
  }

  if (!encryptionSecret) {
    return NextResponse.json(
      { status: "unhealthy", reason: "ENCRYPTION_SECRET not configured" },
      { status: 503 },
    );
  }

  return NextResponse.json({ status: "ok" });
}