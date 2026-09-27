import { NextRequest, NextResponse } from "next/server";

const WORKER_API = process.env.RPA_WORKER_URL || "http://localhost:8080";
const WORKER_SECRET = process.env.RPA_WORKER_SECRET || "";

function authHeaders() {
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${WORKER_SECRET}`,
  };
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const res = await fetch(`${WORKER_API}/proxies/${id}`, {
      method: "DELETE",
      headers: authHeaders(),
      signal: AbortSignal.timeout(10_000),
    });
    const data = await res.json().catch(() => ({}));
    return NextResponse.json(data, { status: res.status });
  } catch (e) {
    console.error("[RPA API] DELETE /proxies/[id] error:", e);
    return NextResponse.json({ error: "Connection failed" }, { status: 503 });
  }
}

export async function PATCH(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const res = await fetch(`${WORKER_API}/proxies/${id}/deactivate`, {
      method: "PATCH",
      headers: authHeaders(),
      signal: AbortSignal.timeout(10_000),
    });
    const data = await res.json().catch(() => ({}));
    return NextResponse.json(data, { status: res.status });
  } catch (e) {
    console.error("[RPA API] PATCH /proxies/[id] error:", e);
    return NextResponse.json({ error: "Connection failed" }, { status: 503 });
  }
}