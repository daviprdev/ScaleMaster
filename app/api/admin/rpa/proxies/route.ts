import { NextRequest, NextResponse } from "next/server";

const WORKER_API = process.env.RPA_WORKER_URL || "http://localhost:8080";
const WORKER_SECRET = process.env.RPA_WORKER_SECRET || "";

function authHeaders() {
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${WORKER_SECRET}`,
  };
}

export async function GET(request: NextRequest) {
  try {
    const includeInactive = request.nextUrl.searchParams.get("include_inactive");
    const url = `${WORKER_API}/proxies${includeInactive ? "?include_inactive=true" : ""}`;
    const res = await fetch(url, {
      headers: authHeaders(),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      return NextResponse.json({ error: "Worker unavailable" }, { status: 502 });
    }
    const data = await res.json();
    return NextResponse.json(data);
  } catch (e) {
    console.error("[RPA API] GET /proxies error:", e);
    return NextResponse.json({ error: "Connection failed" }, { status: 503 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const res = await fetch(`${WORKER_API}/proxies`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      return NextResponse.json(data, { status: res.status });
    }
    return NextResponse.json(data, { status: 201 });
  } catch (e) {
    console.error("[RPA API] POST /proxies error:", e);
    return NextResponse.json({ error: "Connection failed" }, { status: 503 });
  }
}