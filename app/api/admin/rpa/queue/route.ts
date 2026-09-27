import { NextRequest, NextResponse } from "next/server";
const WORKER_API = process.env.RPA_WORKER_URL || "http://localhost:8080";
const WORKER_SECRET = process.env.RPA_WORKER_SECRET || "";

export async function GET() {
  try {
    const res = await fetch(`${WORKER_API}/queue/status`, {
      headers: { Authorization: `Bearer ${WORKER_SECRET}` },
      signal: AbortSignal.timeout(10_000),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return NextResponse.json(data, { status: res.status });
    return NextResponse.json(data);
  } catch (e) {
    console.error("[RPA API] GET /queue/status error:", e);
    return NextResponse.json({ error: "Connection failed" }, { status: 503 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const action = body.action; // "pause" or "resume"
    if (!["pause", "resume"].includes(action)) {
      return NextResponse.json({ error: "action must be 'pause' or 'resume'" }, { status: 400 });
    }
    const res = await fetch(`${WORKER_API}/queue/${action}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${WORKER_SECRET}`,
      },
      signal: AbortSignal.timeout(10_000),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return NextResponse.json(data, { status: res.status });
    return NextResponse.json(data);
  } catch (e) {
    console.error("[RPA API] POST /queue error:", e);
    return NextResponse.json({ error: "Connection failed" }, { status: 503 });
  }
}