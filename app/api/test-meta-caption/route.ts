/**
 * Rota de diagnóstico temporária — elimina Supabase da equação.
 *
 * Dispara um container de Reel diretamente para a Meta Graph API com uma
 * legenda hardcoded e retorna a resposta RAW completa para inspeção.
 *
 * POST /api/test-meta-caption
 * Body: { ig_account_id: string, access_token: string, video_url: string }
 *
 * REMOVER após confirmar que as legendas estão funcionando em produção.
 */

import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

const GRAPH_API = "https://graph.instagram.com/v21.0";

// Legenda hardcoded com emojis, newlines e caracteres especiais — worst-case de encoding
const TEST_CAPTION =
  "🔥 Teste de legenda AutoScale!\n\n🎨 Você sabia que emojis e quebras de linha\n" +
  "são o maior desafio no encoding da Meta API?\n\n" +
  "#teste #autoscale #debug\n\n" +
  "Linha final sem emoji.";

export async function POST(req: NextRequest) {
  let body: { ig_account_id?: string; access_token?: string; video_url?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body JSON inválido." }, { status: 400 });
  }

  const { ig_account_id, access_token, video_url } = body;
  if (!ig_account_id || !access_token || !video_url) {
    return NextResponse.json(
      { error: "Campos obrigatórios: ig_account_id, access_token, video_url" },
      { status: 400 }
    );
  }

  // ── Form-encoded (abordagem documentada pela Meta) ─────────────────────────
  const formBody = [
    `media_type=REELS`,
    `video_url=${encodeURIComponent(video_url)}`,
    `caption=${encodeURIComponent(TEST_CAPTION)}`,
    `access_token=${encodeURIComponent(access_token)}`,
  ].join("&");

  console.log("[test-meta-caption] Disparando container de teste...");
  console.log("[test-meta-caption] caption hardcoded:", TEST_CAPTION);
  console.log("[test-meta-caption] formBody (sem token):",
    formBody.replace(encodeURIComponent(access_token), "[TOKEN]"));

  let rawResponse = "";
  let httpStatus = 0;

  try {
    const res = await fetch(`${GRAPH_API}/${ig_account_id}/media`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: formBody,
      signal: AbortSignal.timeout(15_000),
    });

    httpStatus = res.status;
    rawResponse = await res.text();
    console.log("[test-meta-caption] HTTP status:", httpStatus);
    console.log("[test-meta-caption] RAW RESPONSE:", rawResponse);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[test-meta-caption] fetch error:", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }

  let parsed: unknown = null;
  try { parsed = JSON.parse(rawResponse); } catch { /* mantém null */ }

  return NextResponse.json({
    caption_sent: TEST_CAPTION,
    encoding_preview: encodeURIComponent(TEST_CAPTION).slice(0, 200),
    http_status: httpStatus,
    raw_meta_response: rawResponse,
    parsed_response: parsed,
    body_sent_redacted: formBody
      .replace(encodeURIComponent(access_token), "[TOKEN_REDACTED]"),
  });
}
