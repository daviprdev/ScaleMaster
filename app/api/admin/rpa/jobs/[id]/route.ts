import { NextRequest, NextResponse } from "next/server";

const WORKER_API = process.env.RPA_WORKER_URL || "http://localhost:8080";
const WORKER_SECRET = process.env.RPA_WORKER_SECRET || "";

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const res = await fetch(`${WORKER_API}/jobs/${id}`, {
      method: "DELETE",
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
    console.error("[RPA API] DELETE /jobs/[id] error:", e);
    return NextResponse.json({ error: "Connection failed" }, { status: 503 });
  }
}