import { NextRequest, NextResponse } from "next/server";

const WORKER_API = process.env.RPA_WORKER_URL || "http://localhost:8080";
const WORKER_SECRET = process.env.RPA_WORKER_SECRET || "";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const res = await fetch(`${WORKER_API}/jobs/${id}/stages`, {
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${WORKER_SECRET}`,
      },
      signal: AbortSignal.timeout(10_000),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      return NextResponse.json(data, { status: res.status });
    }
    return NextResponse.json(data);
  } catch (e) {
    console.error("[RPA API] GET /jobs/[id]/stages error:", e);
    return NextResponse.json({ error: "Connection failed" }, { status: 503 });
  }
}