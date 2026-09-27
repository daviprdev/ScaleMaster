import { NextRequest, NextResponse } from "next/server";

const WORKER_API = process.env.RPA_WORKER_URL || "http://localhost:8080";
const WORKER_SECRET = process.env.RPA_WORKER_SECRET || "";

function authHeaders() {
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${WORKER_SECRET}`,
  };
}

export async function GET() {
  try {
    const res = await fetch(`${WORKER_API}/jobs`, {
      headers: authHeaders(),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      return NextResponse.json({ error: "Worker unavailable" }, { status: 502 });
    }
    const data = await res.json();
    return NextResponse.json(data);
  } catch (e) {
    console.error("[RPA API] GET /jobs error:", e);
    return NextResponse.json({ error: "Connection failed" }, { status: 503 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    // Worker aceita credenciais em texto puro e cifra internamente
    // Enviar password, totp_secret, magic_link_token conforme worker espera
    const payload = {
      username: body.username,
      password: body.password,
      totp_secret: body.totp_secret,
      magic_link_token: body.magic_link_token,
      photo_url: body.photo_url,
      story_media_url: body.story_media_url,
      story_link_url: body.story_link_url,
      story_link_text: body.story_link_text,
      highlight_title: body.highlight_title,
    };

    const res = await fetch(`${WORKER_API}/jobs`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(15_000),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      return NextResponse.json(data, { status: res.status });
    }
    return NextResponse.json(data, { status: 201 });
  } catch (e) {
    console.error("[RPA API] POST /jobs error:", e);
    return NextResponse.json({ error: "Connection failed" }, { status: 503 });
  }
}