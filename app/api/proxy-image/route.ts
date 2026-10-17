import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isAllowedHost, fetchAllowlisted } from "@/lib/safe-media-fetch";

export const runtime = "nodejs";

// Domínios CDN permitidos — evita uso como proxy genérico (SSRF). Supabase só
// o host EXATO do projeto: "supabase.co" aceitava o projeto de qualquer um,
// e um SVG com <script> hospedado lá rodava na origem scalemaster.tech (XSS).
function ownSupabaseHost(): string {
  try {
    return new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").hostname;
  } catch {
    return "";
  }
}
const ALLOWED_HOSTS = [
  "cdninstagram.com",
  "fbcdn.net",
  "instagram.com",
  "lookaside.fbsbx.com",
  ownSupabaseHost(), // Supabase Storage (avatars bucket)
].filter(Boolean);

// Só imagem raster — nunca SVG/HTML, que o navegador executaria.
const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif", "image/avif"]);
const MAX_IMAGE_BYTES = 15 * 1024 * 1024;

// Allowlist + bloqueio de IP privado/metadata; revalidada a cada redirect
// dentro de fetchAllowlisted (ver lib/safe-media-fetch.ts).
function isAllowed(raw: string): boolean {
  return isAllowedHost(raw, ALLOWED_HOSTS);
}

export async function GET(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return new NextResponse("Não autenticado.", { status: 401 });
  }

  const url = req.nextUrl.searchParams.get("url");

  if (!url) {
    return new NextResponse("Missing url param", { status: 400 });
  }

  if (!isAllowed(url)) {
    return new NextResponse("URL not allowed", { status: 403 });
  }

  try {
    const upstream = await fetchAllowlisted(url, ALLOWED_HOSTS, {
      headers: {
        Referer: "https://www.instagram.com/",
        Origin: "https://www.instagram.com",
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        Accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        "sec-fetch-dest": "image",
        "sec-fetch-mode": "no-cors",
        "sec-fetch-site": "cross-site",
      },
    });

    if (!upstream.ok) {
      return new NextResponse(`Upstream ${upstream.status}`, { status: 502 });
    }

    const contentType = (upstream.headers.get("content-type") ?? "image/jpeg").split(";")[0].trim().toLowerCase();
    if (!IMAGE_TYPES.has(contentType)) {
      return new NextResponse("Tipo de arquivo não permitido", { status: 415 });
    }
    if (Number(upstream.headers.get("content-length") ?? 0) > MAX_IMAGE_BYTES) {
      return new NextResponse("Imagem grande demais", { status: 413 });
    }
    const buffer = await upstream.arrayBuffer();
    if (buffer.byteLength > MAX_IMAGE_BYTES) {
      return new NextResponse("Imagem grande demais", { status: 413 });
    }

    return new NextResponse(buffer, {
      headers: {
        "Content-Type": contentType,
        // Cache por 24h no CDN/browser, aceita stale por até 7 dias enquanto revalida
        "Cache-Control": "public, max-age=86400, stale-while-revalidate=604800",
        "X-Content-Type-Options": "nosniff",
        // Mesmo que algo passe, a resposta não executa script nem carrega nada.
        "Content-Security-Policy": "default-src 'none'; sandbox",
      },
    });
  } catch (err) {
    console.error("[proxy-image] fetch error:", err);
    return new NextResponse("Failed to fetch image", { status: 502 });
  }
}
