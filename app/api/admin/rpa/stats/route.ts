import { NextResponse } from "next/server";

const WORKER_API = process.env.RPA_WORKER_URL || "http://localhost:8080";
const WORKER_SECRET = process.env.RPA_WORKER_SECRET || "";

export async function GET() {
  try {
    const res = await fetch(`${WORKER_API}/stats`, {
      headers: { Authorization: `Bearer ${WORKER_SECRET}` },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      return NextResponse.json({ error: "Worker unavailable" }, { status: 502 });
    }
    return NextResponse.json(await res.json());
  } catch (e) {
    console.error("[RPA API] GET /stats error:", e);
    return NextResponse.json({ error: "Connection failed" }, { status: 503 });
  }
}